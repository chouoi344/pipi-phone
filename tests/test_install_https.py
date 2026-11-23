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

    def test_existing_route_and_docker_network_are_avoided_and_saved(self):
        Path(".env").write_text("PIPI_PORT=19000")
        replies = ["network-1", '[{"Subnet":"172.30.0.0/16"}]', '[{"dst":"10.0.0.0/24"}]']
        with patch.object(install, "output", side_effect=replies) as query, patch("shutil.which", return_value="ip"):
            install.configure_proxy_network()
            install.configure_proxy_network()
        self.assertEqual(query.call_count, 3)
        self.assertEqual(Path(".env").read_text(), "PIPI_PORT=19000\nPIPI_HTTPS_PREFIX=10.0.1\n")

    def test_cloud_nat_address_is_discovered_and_reused(self):
        interfaces = '[{"addr_info":[{"local":"172.16.22.33"}]}]'
        ip_service = subprocess.CompletedProcess([], 0, stdout="47.1.2.3\n")
        with patch.object(install, "output", return_value=interfaces), patch("shutil.which", return_value="ip"), \
                patch("subprocess.run", return_value=ip_service) as request:
            self.assertEqual(install.configure_address(), "47.1.2.3")
            self.assertEqual(install.configure_address(), "47.1.2.3")
        request.assert_called_once()

    def test_global_interface_is_used_without_an_external_lookup(self):
        interfaces = '[{"addr_info":[{"local":"47.1.2.4"}]}]'
        with patch.object(install, "output", return_value=interfaces), patch("shutil.which", return_value="ip"), \
                patch("subprocess.run") as request:
            self.assertEqual(install.public_ip(), "47.1.2.4")
        request.assert_not_called()

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
        container = {"Config": {"Labels": {
            "com.docker.compose.project": "phone",
            "com.docker.compose.project.working_dir": str(Path.cwd()),
            "com.docker.compose.project.config_files": str(Path.cwd() / "compose.yaml")
        }}, "Mounts": [{"Destination": "/app/data", "Name": "preexisting_volume"}]}
        with patch.object(install, "output", side_effect=[json.dumps(config), "id", "id", json.dumps([container])]), \
                self.assertRaises(SystemExit):
            install.check_installation()
        Path(".env.updates").touch()
        with patch.object(install, "output") as docker, self.assertRaises(SystemExit):
            install.check_installation()
        docker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
