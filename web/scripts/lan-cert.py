# PKG-2: LAN 데모용 자체 서명 인증서 생성. 아침에 와이파이가 바뀌면 다시 실행.
# python scripts/lan-cert.py [--ip 192.168.x.x] (추가 SAN, 여러 번 가능)
# 출력: certs/lan/cert.pem + certs/lan/key.pem (데모용, next dev --experimental-https-*/exe 공용)
import argparse
import datetime
import ipaddress
import os
import socket
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

OUTDIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "certs", "lan")


def local_ips():
    found = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # 패킷 안 나감, 소스 IP만 확인
        found.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except socket.gaierror:
        pass
    return sorted(ip for ip in found if not ip.startswith("169.254."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", action="append", default=[], help="추가 SAN IP")
    ap.add_argument("--days", type=int, default=825)
    args = ap.parse_args()

    ips = local_ips()
    for extra in args.ip:
        try:
            ipaddress.ip_address(extra)
            if extra not in ips:
                ips.append(extra)
        except ValueError:
            print(f"SKIP bad ip: {extra}", flush=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "oishie-lan")])
    now = datetime.datetime.now(datetime.timezone.utc)
    sans = [x509.DNSName("localhost")]
    for ip in ips:
        sans.append(x509.IPAddress(ipaddress.ip_address(ip)))
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=args.days))
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    os.makedirs(OUTDIR, exist_ok=True)
    key_path = os.path.join(OUTDIR, "key.pem")
    cert_path = os.path.join(OUTDIR, "cert.pem")
    with open(key_path, "wb") as f:
        f.write(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            )
        )
    os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    print(f"CERT ok: {cert_path}", flush=True)
    print(f"SAN ips: {', '.join(ips)}", flush=True)


main()
