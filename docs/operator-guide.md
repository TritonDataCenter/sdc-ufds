---
title: UFDS Operator Guide
markdown2extras: tables, code-friendly
apisections: Key Rotation, SPC, UFDS
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

UFDS key rotation impacts multiple feature areas and requires about an hour to complete from start to finish.

The functional areas impacted during the change window include:

- authentication for Triton, Manta API, and the Triton Service portal
- smartlogin
- account CRUD and fabric creation
- firewall rule CRUD
- billing check

## Procedure Summary

The high-level steps are as follows:

1. Update the DCs that have UFDS slaves:
  - Upgrade the Triton components that have UFDS configuration bug fixes.
  - Set a new, local UFDS password.
  - Configure the passwords so they still talk to the UFDS master using the current password. During this stage, only the DC being updated is impacted.

2. Update us-west-1:
  - Upgrade the Triton components that have UFDS configuration bug fixes.
  - Set a new, local UFDS password. Once this is done, all services pointing to the UFDS master will not work. These services include all ```ufds-replicators```, sso, billing callback, and cloudapi/adminui requests that write to UFDS.
  - Update the remote UFDS password on each DC that has UFDS slaves.

## Procedure

Before you begin, make sure that you have the unique passwords ready.

**DC maint start:**

```
sdcadm dc-maint start --message="This DC is in maintenance.  Details available at https://status.joyent.com/"

## confirm status
sdcadm dc-maint status
```

**On each DC that has UFDS slaves:**

1. Run ```sdc-usbkey``` mount.

2. Update ```/usbkey/config and /mnt/usbkey/config``` to set ```ufds_ldap_root_pw``` to the new ```<SLAVE_PW>```.
```
sdc-usbkey unmount
```
3. Modify the local UFDS password to the new password.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<SLAVE_PW>
```
4. Reboot ```cloudapi```,``` mahi```, ```adminui```, and ```fwapi``` to ensure that new password takes effect.
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
5. Restart the ```ufds-capi``` service in the ```ufds``` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
6. Restart the ```napi-ufds-watcher``` service in the ```sdc``` zone.
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
7. Update the Manta authcache UFDS password stored in the ```sapi``` instance metadata, and then reboot the zone.
```
sapiadm update $(sdc-vmname mahi) metadata.UFDS_ROOT_PW=<LOCAL_UFDS_PW>
vmadm reboot $(sdc-vmname mahi)
```
## Testing

1. Test all affected functions, including ```CRUD account/sub-user/role```, ```provisioning```, ```list firewall rules```, and Manta CLI.
2. Check CNS to ensure it automatically picks up the password change.
3. Check that the ```ufds-master``` log doesn't have any connection errors. Connection errors indicate that some consumers still have the old password.

**On us-west-1 UFDS master**:

1. Update ```/usbkey/config``` and ```/mnt/usbkey/config``` and set ```ufds_ldap_root_pw``` to the new ```<MASTER_PW>```.
2. Update the ```ufds``` password to the new password ```<MASTER_PW>```.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<MASTER_PW>
```
3. Reboot ```cloudapi```, ```mahi```, ```adminui```, and ```fwapi```.
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
4. Restart the ```ufds-capi``` service in the ```ufds``` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
5. Restart the ```napi-ufds-watcher``` service in the ```sdc``` zone.
```
svcadm -z $(vmadm lookup alias=~sdc0) restart napi-ufds-watcher
```
6. Update the password in the Manta authcache zone.

7. Test.

**On sdcsso and billing-callback-a/b zones**:

1. Update the ```billing-callback``` UFDS password in ``` /opt/piranha-billing-server/config.json```, and then restart the service.

	**Note**: The ```config-agent``` handles this as expected. There is no need to update the ```sdcsso ufds``` password in ```/opt/smartdc/sdcsso/cfg/config.json``` and restarting the service ```config-agent```.

**On each DC that has UFDS slaves**:

1. Set the remote UFDS password to match the new password for master.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<MASTER_PW>
```
2. Reboot ```cloudapi```, ```mahi```, ```adminui```, and ```fwapi```.
```
for uuid in $(sdcadm insts cloudapi adminui mahi fwapi | grep -v INSTANCE | awk '{print $1}'); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
3. Restart the ```capi``` service in the ```ufds``` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
4. Restart the ```napi-ufds-watcher``` service in the ```sdc``` zone.
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
5. Test.

## Update Components

1. Update Manta webapi and authcache for each headnode in us-east-1, us-east-2, and us-east-3:
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

2. Update madtom and marlin-dashboard in us-east-1 and us-east-3.

**In us-east-1**:
```
mdash=$(manta-adm show marlin-dashboard | awk '/marlin-dashboard/ {print $3}')
sapiadm update "$mdash" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
```
**In us-east-3**:
```
madtom=$(manta-adm show madtom | awk '/madtom/ {print $3}')
sapiadm update "$madtom" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
```
3. Restart chef on the portal instances.
```
svcadm restart chef
```
4. End the DC maint.
```
sdcadm dc-maint stop
# confirm status
sdcadm dc-maint status
```
