---
title: UFDS Operator Guide
markdown2extras: tables, code-friendly
apisections: Overview, Getting Started
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

## UFDS Key Rotation

UFDS key rotation impacts multiple feature areas and require about an hour to complete from start to finish.

**Functional areas impacted during change window**:

- authentication for triton/manta API and portal
- smartlogin
- account CRUD and fabric creation
- firewall rule CRUD
- billing check

## High-level steps:

1. Update DCs that have UFDS slaves: 

- Upgrade Triton components that have ufds configuration bug fixes. 
- Set a new, local ufds password. 
- Configure the passwords so they still talk to UFDS master using the current password. (During this stage, only the DC being updated is impacted)

2. Update west-1: 
- Upgrade Triton components that have ufds configuration bug fixes. 
- Set new local ufds password. (After this, all services pointing to the UFDS master will not work. These services include all ufds-replicators, sso, billing callback, and cloudapi/adminui requests that write to UFDS.)
- Update the remote UFDS password on DCs with the UFDS slaves.

## Detailed steps:

**DC maint start**

```
sdcadm dc-maint start --message="This DC is in maintenance.  Details available at https://status.joyent.com/"

## confirm status
sdcadm dc-maint status
```

Make sure you have the unique passwords ready. 

**On each DC that has the slave UFDS:**

1. Run ```sdc-usbkey``` mount.
2. Update ```/usbkey/config and /mnt/usbkey/config``` to set ```ufds_ldap_root_pw``` to the new ```<SLAVE_PW>```.
 - sdc-usbkey unmount
3. Modify local ufds password to the new value.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<SLAVE_PW>
```
4.Reboot cloudapi, mahi, adminui, fwapi to ensure that new password takes effect.
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
5. Restart capi service in ufds zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
6.Restart napi-ufds-watcher service in sdc zone
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
7.Update manta authcache ufds password, stored in the sapi instance metadata, and reboot the zone.
```
sapiadm update $(sdc-vmname mahi) metadata.UFDS_ROOT_PW=<LOCAL_UFDS_PW> 
vmadm reboot $(sdc-vmname mahi)
```
## Testing
1. Test all features affected (CRUD account/sub-user/role, provisioning, list firewall rules, manta CLI). 
2. Check CNS. It should automatically pick up the password change. 
3. Check that ufds-master log doesn't have any connection errors. Those errors indicate that some consumers still have the old password.

**On west-1, the UFDS master**:

1. Update ```/usbkey/config``` and ```/mnt/usbkey/config``` and set ```ufds_ldap_root_pw``` to the new ```<MASTER_PW>```
2. Update ufds password to the new password <MASTER_PW>
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<MASTER_PW>
```
3. Reboot cloudapi, mahi, adminui, fwapi.
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
4. Restart capi service in ufds zone
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
5. Restart napi-ufds-watcher service in sdc zone
```
svcadm -z $(vmadm lookup alias=~sdc0) restart napi-ufds-watcher
```
6. Update password in manta authcache zone (see step 8 in previous section)**Note there isn't a step 8 in the previous section**
7. Test

**On sdcsso and billing-callback-a/b zones**:

1. Update billing-callback ufds password in /opt/piranha-billing-server/config.json, restart service

*Note: The ```config-agent``` handles this as expected. There is no need to update the sdcsso ufds password in /opt/smartdc/sdcsso/cfg/config.json and restarting the service config-agent.*

**On each DC that has UFDS slaves**:

1. Set remote ufds password (this time to the new one for master)
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<MASTER_PW>
```
2. Reboot cloudapi, mahi, adminui, fwapi
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
3. Restart capi service in ufds zone
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
4. Restart napi-ufds-watcher service in sdc zone
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
5. Test

**Update Manta webapi and authcache**

In each of east1, east2, east3 headnodes:
```
source /usbkey/config
webapi=( $(manta-adm show -Ho zonename webapi) )
for api in "${webapi[@]}"; do
  sapiadm update "$api" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
done
mahi=( $(manta-adm show -Ho zonename authcache) )
for m in "${mahi[@]}"; do
  sapiadm update "$m" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
manta-oneach -z "$m" reboot
```

**Update madtom and marlin-dashboard**

In us-east-1:
```
mdash=$(manta-adm show marlin-dashboard | awk '/marlin-dashboard/ {print $3}')
sapiadm update "$mdash" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
```
**In us-east-3:
```
madtom=$(manta-adm show madtom | awk '/madtom/ {print $3}')
sapiadm update "$madtom" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
```
**Restart chef on portal instances**
```
svcadm restart chef
```
**DC maint end**
```
sdcadm dc-maint stop
# confirm status
sdcadm dc-maint status
```
