# Temporary Credentials (STS)

UFDS supports temporary security credentials for AWS STS (Security Token Service)
compatibility. These credentials have a limited lifespan and automatically expire.

## Overview

Temporary credentials are stored as `accesskey` entries with `credentialtype=temporary`.
They include:

- **accesskeyid**: The access key identifier
- **accesskeysecret**: The secret access key
- **sessiontoken**: Token required for API authentication
- **expiration**: ISO timestamp when the credential expires
- **principaluuid**: UUID of the user who owns the credential
- **credentialtype**: Set to `temporary` (vs `permanent` for regular keys)

## Automatic Cleanup

Expired temporary credentials are automatically cleaned up by UFDS. The cleanup job
runs periodically and removes credentials where `expiration <= now`.

### How It Works

1. Searches for entries matching:
   ```
   (&(objectclass=accesskey)(credentialtype=temporary)(expiration<=<current_time>))
   ```

2. Deletes each expired entry with rate limiting (5 concurrent deletes) to avoid
   overloading Moray.

3. Logs results showing count of deleted credentials.

## Manual Cleanup Tool

A CLI tool is provided for manually triggering cleanup of expired credentials.

### Location

```
/opt/smartdc/ufds/bin/cleanup-expired-creds
```

### Usage

```bash
./bin/cleanup-expired-creds [-c config_file] [-d] [-h]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --config` | Path to config file (default: `etc/config.coal.json`) |
| `-d, --debug` | Enable debug logging (shows each credential deleted) |
| `-h, --help` | Show help message |

### Examples

**Basic cleanup (production config):**
```bash
cd /opt/smartdc/ufds
./bin/cleanup-expired-creds -c etc/config.json
```

**With debug output to see each deletion:**
```bash
./bin/cleanup-expired-creds -c etc/config.json -d
```

**Using COAL development config:**
```bash
./bin/cleanup-expired-creds -c etc/config.coal.json
```

### Sample Output

Normal output:
```json
{"level":30,"msg":"Starting expired credentials cleanup"...}
{"level":30,"msg":"Connected to UFDS, running cleanup..."...}
{"level":30,"count":994,"msg":"Found expired temporary credentials to delete"...}
{"level":30,"deleted":994,"msg":"Successfully deleted expired credentials"...}
{"level":30,"msg":"Cleanup completed successfully"...}
```

Debug output (with `-d` flag) includes each deletion:
```json
{"level":20,"dn":"accesskeyid=abc123..., uuid=user-uuid, ou=users, o=smartdc",
 "accesskeyid":"abc123...","expiration":"2025-11-26T17:00:00.000Z",
 "msg":"Deleting expired temporary credential"...}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all expired credentials deleted |
| 1 | Failure - connection error or some deletions failed |

## Configuration

The cleanup interval can be configured when starting the cleanup service
programmatically:

```javascript
var cleanup = require('./lib/cleanup-expired-credentials');

// Start with custom interval (default is 5 minutes)
var intervalMs = 10 * 60 * 1000; // 10 minutes
cleanup.startCleanupInterval(ufdsClient, log, intervalMs);
```

## Troubleshooting

### "Moray failure: unable to acquire backend connection"

This occurs when too many parallel operations overwhelm Moray. The cleanup tool
uses rate limiting (5 concurrent deletes) to prevent this. If you still see this
error, Moray may be under heavy load from other operations.

### No credentials found

If no expired credentials are found, either:
- All temporary credentials are still valid (not yet expired)
- No temporary credentials exist in the system
- Previous cleanup already removed them

### Permission denied

Ensure the config file has correct `rootDN` and `rootPassword` for UFDS bind.
