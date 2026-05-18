# OpenClaw Archive Manifest

Archives created by `runtime/deploy/archive-openclaw.sh`. Encrypted to
Santiago's age pubkey at `/etc/iago-os/santiago-age.pub`. Retention: 30 days
from creation. Deletion by `iago-archive-prune.timer` (systemd timer; lives
at `/etc/systemd/system/iago-archive-prune.timer` on the VPS).

## Decryption recipe

```bash
# From Santiago's Windows box (private key at ~/.age/santiago.key):
scp santiago@srv1456441:/var/lib/iago-os/openclaw-archive/<file>.age .
age -d -i ~/.age/santiago.key <file>.age > <file>.tar.gz
tar -xzf <file>.tar.gz
```

## Audit

To see prune events:

```bash
journalctl -t iago-archive-prune
```

To see timer state:

```bash
systemctl status iago-archive-prune.timer
journalctl -u iago-archive-prune.timer
```

## Template note

This file is the human-readable source of truth for the manifest header.
`runtime/deploy/archive-openclaw.sh` step 5 contains the same header inlined
as a heredoc — when the script runs on a VPS where this template file is not
present, it writes the inlined copy. If you edit this template, also update
the heredoc inside `archive-openclaw.sh` (or refactor the script to `cat`
this file — preferred for DRY but requires the script to know its install
path on the VPS, which it doesn't, so we keep them duplicated for now).

## Archives

| Timestamp (UTC) | File | Raw size | Raw SHA256 | Encrypted size | Encrypted SHA256 |
| --- | --- | --- | --- | --- | --- |
