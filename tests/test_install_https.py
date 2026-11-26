import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


location = Path(__file__).resolve().parents[1] / "scripts" / "install-https.py"
spec = importlib.util.spec_from_file_location("install_https", location)
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


class InstallHttpsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.addCleanup(os.chdir, Path.cwd())
        os.chdir(temp.name)
        self.enterContext(patch.object(install, "ROOT", Path.cwd()))
        self.enterContext(patch.dict(os.environ, {}, clear=True))

    def test_bridge_stages_a_consistent_version_separately_and_can_be_retried(self):
        source = Path.cwd() / "tag"
        names = ("package.json", "lib/updates.cjs", "scripts/compose-updater.cjs")
        for name in names:
            for root, content in [(Path.cwd(), "old-custom"), (source, "release")]:
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text(content)
        with patch.object(install, "SOURCE", source), patch.object(install, "require_root_control"), \
                patch.object(install, "write_atomic", side_effect=lambda p, s, m: p.write_text(s)) as write:
            worker = install.stage_release_worker("0.13.25")
            self.assertEqual(worker, Path.cwd() / install.STATE / "release-workers/0.13.25")
            self.assertEqual(write.call_count, 3)
            self.assertEqual(install.stage_release_worker("0.13.25"), worker)
            self.assertEqual(write.call_count, 3)
            for name in names:
                self.assertEqual((worker / name).read_text(), "release")
                self.assertEqual(Path(name).read_text(), "old-custom")
            (source / "lib/updates.cjs").write_text("different")
            with self.assertRaisesRegex(SystemExit, "与来源不一致"):
                install.stage_release_worker("0.13.25")
            self.assertEqual((worker / "lib/updates.cjs").read_text(), "release")

    def test_existing_route_and_docker_network_are_avoided_and_saved(self):
        Path(".env").write_text("PIPI_PORT=19000")
        replies = ["network-1", '[{"Subnet":"172.30.0.0/16"}]', '[{"dst":"10.0.0.0/24"}]']
        with patch.object(install, "output", side_effect=replies) as query, patch("shutil.which", return_value="ip"):
            install.configure_proxy_network()
            install.configure_proxy_network()
        self.assertEqual(query.call_count, 3)
        self.assertEqual(Path(".env").read_text(), "PIPI_PORT=19000\nPIPI_HTTPS_PREFIX=10.0.1\n")

    def test_cloud_nat_address_is_discovered_and_reused(self):
        interfaces = json.dumps([
            {"ifname": "lo", "addr_info": [{}]},
            {"ifname": "eth0", "addr_info": [{}, {"family": "inet", "local": "172.16.22.33"}, {}]},
            {"ifname": "docker0"},
        ])
        ip_service = subprocess.CompletedProcess([], 0, stdout="47.1.2.3\n")
        with patch.object(install, "output", return_value=interfaces), patch("shutil.which", return_value="ip"), \
                patch("subprocess.run", return_value=ip_service) as request:
            self.assertEqual(install.configure_address(), "47.1.2.3")
            self.assertEqual(install.configure_address(), "47.1.2.3")
        request.assert_called_once()

    def test_global_interface_is_used_without_an_external_lookup(self):
        interfaces = '[{},{"addr_info":[{},{"peer":"47.1.2.5"},{"local":"invalid"},{"local":"47.1.2.4"}]}]'
        with patch.object(install, "output", return_value=interfaces), patch("shutil.which", return_value="ip"), \
                patch("subprocess.run") as request:
            self.assertEqual(install.public_ip(), "47.1.2.4")
        request.assert_not_called()

    def test_second_lookup_after_unusable_records_and_failed_first_service(self):
        replies = [subprocess.CompletedProcess([], 28, stdout=""), subprocess.CompletedProcess([], 0, stdout="47.1.2.3\n")]
        with patch("shutil.which", return_value="ip"), patch.object(install, "output", return_value='[{"addr_info":[{}]}]'), \
                patch("subprocess.run", side_effect=replies) as request:
            self.assertEqual(install.configure_address(), "47.1.2.3")
            self.assertEqual(request.call_count, 2)
            self.assertIn("PIPI_PUBLIC_IP=47.1.2.3\n", Path(".env.https").read_text())

    def test_failed_local_ip_command_uses_external_lookup(self):
        with patch("shutil.which", return_value="ip"), \
                patch.object(install, "output", side_effect=subprocess.CalledProcessError(1, ["ip"])), \
                patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout="47.1.2.3")):
            self.assertEqual(install.public_ip(), "47.1.2.3")

    def test_ipv6_only_host_preserves_brackets_when_ipv4_lookups_fail(self):
        interfaces = '[{"addr_info":[{},{"local":"fe80::1"},{"local":"2606:4700:4700::1111"}]}]'
        with patch("shutil.which", return_value="ip"), patch.object(install, "output", return_value=interfaces), \
                patch("subprocess.run", return_value=subprocess.CompletedProcess([], 28, stdout="")):
            self.assertEqual(install.configure_address(), "[2606:4700:4700::1111]")

    def test_failed_nat_lookup_reports_the_manual_input_without_writing(self):
        failure = subprocess.CompletedProcess([], 28, stdout="")
        with patch("shutil.which", return_value=None), patch("subprocess.run", return_value=failure) as request, \
                self.assertRaisesRegex(SystemExit, "PIPI_PUBLIC_IP"):
            install.configure_address()
        self.assertEqual(request.call_count, 2)
        self.assertFalse(Path(".env.https").exists())

    def test_private_address_rejected_before_issuing_public_certificate(self):
        with patch.dict(os.environ, PIPI_PUBLIC_IP="192.168.1.20"), self.assertRaises(SystemExit):
            install.configure_address()
        self.assertFalse(Path(".env.https").exists())

    def test_custom_volume_or_updated_deployment_is_preserved(self):
        config = {"name": "phone", "volumes": {"pipi-data": {"name": "phone_pipi-data"}}}
        container = {"Id": "a" * 64, "Config": {"Labels": {
            "com.docker.compose.project": "phone",
            "com.docker.compose.project.working_dir": str(Path.cwd()),
            "com.docker.compose.project.config_files": str(Path.cwd() / "compose.yaml")
        }}, "Mounts": [{"Destination": "/app/data", "Type": "volume", "Name": "preexisting_volume"}]}
        with patch.object(install, "output", side_effect=[json.dumps(config), "id", "id", json.dumps([container])]), \
                self.assertRaises(SystemExit):
            install.check_installation()
        Path(".env.updates").touch()
        with patch.object(install, "output") as docker, self.assertRaises(SystemExit):
            install.check_installation()
        docker.assert_not_called()

    def test_old_project_adopts_its_actual_project_name(self):
        project = {"name": "old-name", "volumes": {"pipi-data": {"name": "old-name_pipi-data"}}}
        container = {"Id": "a" * 64, "Config": {"Labels": {
            "com.docker.compose.project": "old-name", "com.docker.compose.project.working_dir": str(Path.cwd()),
            "com.docker.compose.project.config_files": str(Path.cwd() / "compose.yaml")}},
            "Mounts": [{"Destination": "/app/data", "Type": "volume", "Name": "old-name_pipi-data"}]}
        with patch.object(install, "output", side_effect=[json.dumps({"name": "different"}), "", "id",
                          json.dumps([container]), json.dumps(project)]) as query:
            self.assertEqual(install.check_installation(), (project, container))
        self.assertIn("old-name", query.call_args.args[0])

    def test_running_port_binding_and_repository_win_over_unrelated_defaults(self):
        app = {"ports": [{"target": 8000, "published": 18766}], "environment": {
            "PIPI_UPDATE_REPOSITORY": "chouoi344/pipi-phone", "REQUIRE_SETUP_TOKEN": "0"}}
        config = {"name": "previous", "services": {"pipi-phone": app}}
        container = {"HostConfig": {"PortBindings": {"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "19999"}]}},
                     "Config": {"Env": ["PIPI_UPDATE_REPOSITORY=owner/fork", "REQUIRE_SETUP_TOKEN=0"]}}
        settings = install.update_settings(config, container, False)
        self.assertEqual(settings["PIPI_UPDATE_COMPOSE_PROJECT"], "previous")
        self.assertEqual(settings["PIPI_UPDATE_HEALTH_ORIGIN"], "http://127.0.0.1:19999")
        self.assertEqual(settings["PIPI_PORT"], "19999")
        self.assertEqual(settings["PIPI_HOST_BIND"], "127.0.0.1")
        self.assertEqual(settings["PIPI_UPDATE_REPOSITORY"], "owner/fork")
        container["Config"]["Env"][1] = "REQUIRE_SETUP_TOKEN=1"
        with self.assertRaisesRegex(SystemExit, "REQUIRE_SETUP_TOKEN"):
            install.update_settings(config, container, False)

    def test_completed_rollback_will_not_switch_data_back_on_repeated_enable(self):
        config = {"name": "phone", "volumes": {"pipi-data": {"name": "phone_pipi-data"}}}
        install.STATE.mkdir()
        install.UPDATE_ENV.write_text(install.GENERATED + "\n")
        install.ACTIVE.write_text(json.dumps({"volumes": {"pipi-update-data": {"name": "rollback-restored"}}}))
        (install.STATE / "current.json").write_text(json.dumps({"stage": "done", "status": {"phase": "rolled-back"}}))
        labels = {"com.docker.compose.project": "phone", "com.docker.compose.project.working_dir": str(Path.cwd()),
                  "com.docker.compose.project.config_files": str(Path.cwd() / "compose.yaml")}
        container = {"Id": "a" * 64, "Config": {"Labels": labels}, "Mounts": [
            {"Destination": "/app/data", "Type": "volume", "Name": "phone_pipi-data"}]}
        with patch.object(install, "output", side_effect=[json.dumps(config), "id", "id", json.dumps([container])]), \
                self.assertRaises(SystemExit):
            install.check_installation()
        container["Mounts"][0]["Name"] = "rollback-restored"
        with patch.object(install, "output", side_effect=[json.dumps(config), "id", "id", json.dumps([container])]):
            self.assertEqual(install.check_installation()[1]["Id"], container["Id"])

    def test_interrupted_work_is_left_to_the_original_worker(self):
        install.STATE.mkdir()
        journal = install.STATE / "current.json"
        for stage, phase, busy in [("snapshotting", "backing-up", True), ("recovery-needed", "failed", True),
                                  ("done", "succeeded", False), ("done", "rolled-back", False)]:
            journal.write_text(json.dumps({"stage": stage, "status": {"phase": phase}}))
            self.assertEqual(install.worker_busy(), busy)

    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() == 0, "root-only POSIX permission check")
    def test_root_worker_refuses_group_writable_checkout_and_its_symlink_target(self):
        unsafe = Path("unsafe")
        unsafe.mkdir(mode=0o777)
        unsafe.chmod(0o777)
        (unsafe / "updater.cjs").touch()
        Path("entry.cjs").symlink_to((unsafe / "updater.cjs").resolve())
        with self.assertRaisesRegex(SystemExit, "写入权限"):
            install.require_root_control(Path("entry.cjs"))


if __name__ == "__main__":
    unittest.main()
