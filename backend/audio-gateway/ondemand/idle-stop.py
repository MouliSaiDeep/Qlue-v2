"""Runs only on the audio host. A fenced idle claim prevents stop/wake races."""
import json
import os
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path


def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                            capture_output=True, text=True, timeout=20, check=True)
    return json.loads(result.stdout or '{}')


def begin_boot():
    # Administrative/CloudFormation starts do not pass through the wake Lambda.
    # Clear only a prior boot's shutdown claim, never a claim from this boot.
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    try:
        aws('dynamodb', 'update-item', '--table-name', os.environ['STT_SESSIONS_TABLE'],
            '--key', json.dumps({'pk': {'S': 'HOST#' + os.environ['INSTANCE_ID']}}),
            '--update-expression', 'SET bootId = :boot REMOVE stopToken',
            '--condition-expression', 'attribute_not_exists(bootId) OR bootId <> :boot',
            '--expression-attribute-values', json.dumps({':boot': {'S': boot}}))
    except subprocess.CalledProcessError as error:
        if 'ConditionalCheckFailedException' not in (error.stderr or ''):
            raise


def stop_if_idle():
    with urllib.request.urlopen('http://127.0.0.1:8080/internal-idle', timeout=3) as response:
        status = json.load(response)
    if status.get('active') != 0 or status.get('idleSeconds', 0) < 300:
        return False
    token = uuid.uuid4().hex
    aws('dynamodb', 'update-item', '--table-name', os.environ['STT_SESSIONS_TABLE'],
        '--key', json.dumps({'pk': {'S': 'HOST#' + os.environ['INSTANCE_ID']}}),
        '--update-expression', 'SET stopToken = :token',
        '--condition-expression', 'attribute_not_exists(stopToken) AND (attribute_not_exists(wakeUntil) OR wakeUntil < :now)',
        '--expression-attribute-values', json.dumps({':token': {'S': token}, ':now': {'N': str(int(time.time()))}}))
    # New tickets now receive WARMING. Active sockets are rechecked after the
    # claim; if one raced the first check, remove only our claim and keep serving.
    with urllib.request.urlopen('http://127.0.0.1:8080/internal-idle', timeout=3) as response:
        active = json.load(response).get('active')
    if active != 0:
        aws('dynamodb', 'update-item', '--table-name', os.environ['STT_SESSIONS_TABLE'],
            '--key', json.dumps({'pk': {'S': 'HOST#' + os.environ['INSTANCE_ID']}}), '--update-expression', 'REMOVE stopToken',
            '--condition-expression', 'stopToken = :token',
            '--expression-attribute-values', json.dumps({':token': {'S': token}}))
        return False
    try:
        aws('ec2', 'stop-instances', '--instance-ids', os.environ['INSTANCE_ID'])
    except Exception:
        aws('dynamodb', 'update-item', '--table-name', os.environ['STT_SESSIONS_TABLE'],
            '--key', json.dumps({'pk': {'S': 'HOST#' + os.environ['INSTANCE_ID']}}), '--update-expression', 'REMOVE stopToken',
            '--condition-expression', 'stopToken = :token',
            '--expression-attribute-values', json.dumps({':token': {'S': token}}))
        raise
    return True


if __name__ == '__main__':
    begin_boot()
    while True:
        time.sleep(30)
        try:
            if stop_if_idle():
                break
        except Exception:
            # Missing readiness, network failure or a denied condition fails
            # safely: no instance is stopped on an ambiguous active check.
            print('idle-check-deferred', flush=True)
