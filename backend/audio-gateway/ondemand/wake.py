"""Private Lambda entrypoint. Only owned, active interviews can wake the host."""
import json
import os
import time
import urllib.request
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

cfg = Config(connect_timeout=2, read_timeout=3, retries={'max_attempts': 1})
db = boto3.client('dynamodb', config=cfg)
ec2 = boto3.client('ec2', config=cfg)


def item(table, key):
    return db.get_item(TableName=table, Key=key, ConsistentRead=True).get('Item', {})


def handler(event, context):
    uid, sid = event.get('userId'), event.get('sessionId')
    if not isinstance(uid, str) or not isinstance(sid, str) or len(uid) > 128 or len(sid) > 80:
        return {'ready': False, 'code': 'FORBIDDEN'}
    session = item(os.environ['SESSIONS_TABLE'], {'sessionId': {'S': sid}})
    control = item(os.environ['STT_SESSIONS_TABLE'], {'pk': {'S': 'CONTROL'}})
    deletion = item(os.environ['DELETION_JOBS_TABLE'], {'userId': {'S': uid}})
    if (deletion or control.get('rolloutEnabled', {}).get('BOOL') is not True
            or session.get('userId', {}).get('S') != uid
            or session.get('currentState', {}).get('S') not in (
                'INITIALIZING', 'LOADING_CONTEXT', 'AI_SPEAKING',
                'USER_RESPONDING', 'PROCESSING_RESPONSE', 'SILENCE_DETECTED')):
        return {'ready': False, 'code': 'FORBIDDEN'}
    now = int(time.time())
    # A stale abandoned interview cannot keep restarting compute indefinitely.
    if int(session.get('startedAt', {}).get('N', '0')) < (now - 7200) * 1000:
        return {'ready': False, 'code': 'INTERVIEW_EXPIRED'}
    instance = os.environ['INSTANCE_ID']
    state = ec2.describe_instances(InstanceIds=[instance])['Reservations'][0]['Instances'][0]['State']['Name']
    if state == 'stopped':
        # The prior shutdown has completed. Clear its claim before starting.
        db.update_item(TableName=os.environ['STT_SESSIONS_TABLE'], Key={'pk': {'S': 'HOST#' + instance}},
                       UpdateExpression='SET wakeUntil = :until REMOVE stopToken',
                       ExpressionAttributeValues={':until': {'N': str(now + 300)}})
        ec2.start_instances(InstanceIds=[instance])
        return {'ready': False, 'code': 'STT_GATEWAY_WARMING', 'retryAfterMs': 3000}
    if state not in ('running', 'pending'):
        return {'ready': False, 'code': 'STT_GATEWAY_WARMING', 'retryAfterMs': 3000}
    try:
        db.update_item(TableName=os.environ['STT_SESSIONS_TABLE'], Key={'pk': {'S': 'HOST#' + instance}},
                       UpdateExpression='SET wakeUntil = :until',
                       ConditionExpression='attribute_not_exists(stopToken)',
                       ExpressionAttributeValues={':until': {'N': str(now + 300)}})
    except ClientError as error:
        if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return {'ready': False, 'code': 'STT_GATEWAY_WARMING', 'retryAfterMs': 3000}
    if state == 'running':
        try:
            request = urllib.request.Request(os.environ['HEALTH_URL'], headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=3) as response:
                health = json.load(response)
                if (response.status == 200 and health.get('ready') is True
                        and health.get('sttEnabled') is True and health.get('hosting') == 'ondemand'):
                    return {'ready': True}
        except Exception:
            pass  # Booting is retryable; never mint an unusable audio ticket.
    return {'ready': False, 'code': 'STT_GATEWAY_WARMING', 'retryAfterMs': 3000}
