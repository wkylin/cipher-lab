import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const dir = path.resolve('.certs');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const key = path.join(dir, 'localhost-key.pem');
const cert = path.join(dir, 'localhost.pem');
if (!existsSync(key) || !existsSync(cert)) {
  const config = path.join(dir, 'openssl.cnf');
  writeFileSync(config, `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = ext\n[dn]\nCN = localhost\n[ext]\nsubjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nbasicConstraints = critical,CA:FALSE\n`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', key, '-out', cert, '-config', config], { stdio: 'pipe' });
  console.log('已生成本地自签 HTTPS 证书（30 天）。浏览器首次访问需要确认本地证书；README 有 mkcert 信任选项。');
} else console.log('使用现有 .certs 本地 HTTPS 证书。');
