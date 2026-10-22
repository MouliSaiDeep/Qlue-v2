import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

HERE = Path(__file__).parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WakeTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'SESSIONS_TABLE': 'sessions', 'STT_SESSIONS_TABLE': 'stt',
            'DELETION_JOBS_TABLE': 'deletions', 'INSTANCE_ID': 'i-host', 'HEALTH_URL': 'https://example.com/healthz'})
        self.env.start()
        with patch('boto3.client'):
            self.wake = load('wake_test', 'wake.py')
        self.session = {'userId': {'S': 'owner'}, 'currentState': {'S': 'USER_RESPONDING'}, 'startedAt': {'N': '1000000'}}
        self.control = {'rolloutEnabled': {'BOOL': True}}
        self.deletion = {}
        self.wake.item = lambda table, key: {'sessions': self.session, 'stt': self.control, 'deletions': self.deletion}[table]
        self.time = patch.object(self.wake.time, 'time', return_value=1100)
        self.time.start()
        self.wake.ec2.describe_instances.return_value = {'Reservations': [{'Instances': [{'State': {'Name': 'running'}}]}]}

    def tearDown(self):
        self.env.stop()
        self.time.stop()

    def call(self):
        return self.wake.handler({'userId': 'owner', 'sessionId': 'session'}, None)

    def test_wrong_owner_deletion_rollout_or_stale_session_never_wakes_compute(self):
        for field, value in [('userId', {'S': 'other'}), ('currentState', {'S': 'TERMINATED'}), ('startedAt', {'N': '0'})]:
            old = self.session[field]
            self.session[field] = value
            if field == 'startedAt':
                self.time.stop()
                self.time = patch.object(self.wake.time, 'time', return_value=10000)
                self.time.start()
            self.assertFalse(self.call()['ready'])
            self.session[field] = old
        self.wake.ec2.describe_instances.assert_not_called()

    def test_stopped_host_starts_and_returns_warming_without_paid_transcribe(self):
        self.wake.ec2.describe_instances.return_value['Reservations'][0]['Instances'][0]['State']['Name'] = 'stopped'
        self.assertEqual(self.call()['code'], 'STT_GATEWAY_WARMING')
        self.wake.ec2.start_instances.assert_called_once_with(InstanceIds=['i-host'])
        self.assertIn('REMOVE stopToken', self.wake.db.update_item.call_args.kwargs['UpdateExpression'])
        self.assertEqual(self.wake.db.update_item.call_args.kwargs['Key'], {'pk': {'S': 'HOST#i-host'}})

    def test_running_host_must_report_ready_from_new_origin(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        with patch.object(self.wake.urllib.request, 'urlopen', return_value=response), patch.object(self.wake.json, 'load', return_value={'ready': True, 'sttEnabled': True, 'hosting': 'ecs'}):
            self.assertFalse(self.call()['ready'])
        with patch.object(self.wake.urllib.request, 'urlopen', return_value=response), patch.object(self.wake.json, 'load', return_value={'ready': True, 'sttEnabled': True, 'hosting': 'ondemand'}):
            self.assertTrue(self.call()['ready'])

    def test_shutdown_claim_cannot_be_overridden_by_a_racing_wake(self):
        self.wake.db.update_item.side_effect = ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')
        self.assertEqual(self.call()['code'], 'STT_GATEWAY_WARMING')
        self.wake.ec2.start_instances.assert_not_called()

    def test_deleted_owner_and_disabled_rollout_never_wake(self):
        self.deletion['userId'] = {'S': 'owner'}
        self.assertFalse(self.call()['ready'])
        self.deletion.clear()
        self.control['rolloutEnabled']['BOOL'] = False
        self.assertFalse(self.call()['ready'])
        self.wake.ec2.describe_instances.assert_not_called()


class IdleTests(unittest.TestCase):
    def setUp(self):
        self.idle = load('idle_test', 'idle-stop.py')
        self.env = patch.dict(os.environ, {'STT_SESSIONS_TABLE': 'stt', 'INSTANCE_ID': 'i-host'})
        self.env.start()
        self.idle.aws = MagicMock()

    def tearDown(self):
        self.env.stop()

    def statuses(self, values):
        responses = []
        for value in values:
            response = MagicMock()
            response.__enter__.return_value = io.BytesIO(json.dumps(value).encode())
            responses.append(response)
        return patch.object(self.idle.urllib.request, 'urlopen', side_effect=responses)

    def test_busy_or_recent_host_is_never_stopped(self):
        for state in [{'active': 1, 'idleSeconds': 900}, {'active': 0, 'idleSeconds': 100}]:
            with self.statuses([state]):
                self.assertFalse(self.idle.stop_if_idle())
        self.idle.aws.assert_not_called()

    def test_idle_host_claims_then_rechecks_before_self_stop(self):
        with self.statuses([{'active': 0, 'idleSeconds': 900}, {'active': 0}]):
            self.assertTrue(self.idle.stop_if_idle())
        self.assertEqual(self.idle.aws.call_args.args, ('ec2', 'stop-instances', '--instance-ids', 'i-host'))
        first = self.idle.aws.call_args_list[0].args
        self.assertEqual(json.loads(first[first.index('--key') + 1]), {'pk': {'S': 'HOST#i-host'}})

    def test_active_socket_racing_shutdown_releases_only_its_claim(self):
        with self.statuses([{'active': 0, 'idleSeconds': 900}, {'active': 1}]):
            self.assertFalse(self.idle.stop_if_idle())
        self.assertIn('REMOVE stopToken', self.idle.aws.call_args.args)
        self.assertFalse(any(c.args[:2] == ('ec2', 'stop-instances') for c in self.idle.aws.call_args_list))

    def test_failed_stop_clears_claim_so_future_requests_can_retry(self):
        self.idle.aws.side_effect = [{}, RuntimeError('network'), {}]
        with self.statuses([{'active': 0, 'idleSeconds': 900}, {'active': 0}]):
            with self.assertRaises(RuntimeError):
                self.idle.stop_if_idle()
        self.assertIn('REMOVE stopToken', self.idle.aws.call_args.args)

    def test_administrative_boot_clears_only_a_previous_boots_claim(self):
        with patch.object(self.idle.Path, 'read_text', return_value='new-boot'):
            self.idle.begin_boot()
        args = self.idle.aws.call_args.args
        self.assertIn('attribute_not_exists(bootId) OR bootId <> :boot', args)
        self.assertIn('SET bootId = :boot REMOVE stopToken', args)

    def test_watchdog_restart_in_same_boot_preserves_its_shutdown_claim(self):
        self.idle.aws.side_effect = self.idle.subprocess.CalledProcessError(1, 'aws', stderr='ConditionalCheckFailedException')
        with patch.object(self.idle.Path, 'read_text', return_value='same-boot'):
            self.idle.begin_boot()
        self.idle.aws.assert_called_once()


if __name__ == '__main__':
    unittest.main()
