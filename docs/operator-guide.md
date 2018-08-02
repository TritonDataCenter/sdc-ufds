## UFDS Key Rotation

UFDS key rotation impacts multiple feature areas and requires about an hour to complete from start to finish.

The functional areas impacted during the change window include:

- authentication for Triton, Manta API, and the Triton Service portal
- smartlogin
- account CRUD and fabric creation
- firewall rule CRUD
- billing check

## Procedure summary

The high-level steps are as follows:

1. Update the data centers that have UFDS replicas:
    - Upgrade the Triton components that have UFDS configuration bug fixes.
    - Set a new, local UFDS password.
    - Configure the passwords so they still talk to the UFDS primary using the current password. During this stage, only the data center being updated is impacted.

2. Update us-west-1:
    - Upgrade the Triton components that have UFDS configuration bug fixes.
    - Set a new, local UFDS password. Once this is done, all services pointing to the UFDS primary will not work. These services include all `ufds-replicators`, sso, billing callback, and cloudapi/adminui requests that write to UFDS.
    - Update the remote UFDS password on each data center that has UFDS replicas.

### Before you begin

- Make sure that you have the unique passwords ready. 

    Each data center has it's own local password. One data center is selected as the primary. All others are considered replicas. The local password of the primary is used as the remote password on the replicas. Although you may find exceptions, in general, all data centers replicate from the same primary data center.

    Ops recommends that all data centers use the same password, but you can choose to set different password for each replica.
    Every data center can have a unique password. Every replica uses the primary data center password as the remote password.

- Locate the four log files that contain `ufds-master`. You can find the names by running:
```
svcs -L ufds-master
```

You can check each file by running:
````
tail -1f $(svcs -L ufds-master) | bunyan
````

## Procedure

### Start data center maintenance:

```
sdcadm dc-maint start --message="This DC is in maintenance.  Details available at https://status.joyent.com/"

# confirm status
sdcadm dc-maint status
```

**On each data center that has UFDS replicas:**

1. Run `sdc-usbkey` mount.

2. Update `/usbkey/config and /mnt/usbkey/config` to set `ufds_ldap_root_pw` to the new `<SLAVE_PW>`.
```
sdc-usbkey unmount
```
3. Modify the local UFDS password to the new password.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<SLAVE_PW>
```
4. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi` to ensure that the new password takes effect.
```
for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
5. Restart the `ufds-capi` service in the `ufds` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
6. Restart the `napi-ufds-watcher` service in the `sdc` zone.
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
7. Update the Manta authcache UFDS password stored in the `sapi` instance metadata, and then reboot the zone.
```
sapiadm update $(sdc-vmname mahi) metadata.UFDS_ROOT_PW=<LOCAL_UFDS_PW>
vmadm reboot $(sdc-vmname mahi)
```
## Testing

1. Test all affected functions, including:
    - `CRUD account/sub-user/role`
    - `provisioning`
    - `list firewall rules`
	-  Manta CLI
2. Check CNS to ensure it automatically picks up the password change.
3. Check that the `ufds-master` service logs in the `ufds` zone don't have any connection errors. Connection errors indicate that some customers still have the old password.

**On the us-west-1 UFDS primary**:

1. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<MASTER_PW>`.
2. Update the UFDS password to the new password `<MASTER_PW>`.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<MASTER_PW>
```
3. Reboot ```cloudapi```, ```mahi```, ```adminui```, and ```fwapi```.
```
for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
4. Restart the `ufds-capi` service in the `ufds` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
5. Restart the `napi-ufds-watcher` service in the `sdc` zone.
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
```
6. Update the password in the Manta authcache zone.

7. Test.

**On sdcsso and billing-callback-a/b zones**:

1. Update the `billing-callback` UFDS password in ` /opt/piranha-billing-server/config.json`, and then restart the service.

**On each data center that has UFDS replicas**:

1. Set the remote UFDS password to match the new password for the UFDS primary.
```
sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<MASTER_PW>
```
2. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi`.
```
for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do echo "restarting $uuid"; vmadm reboot $uuid; done
```
3. Restart the `capi` service in the `ufds` zone.
```
svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
```
4. Restart the `napi-ufds-watcher` service in the `sdc` zone.
```
svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher

    **Note**: The `napi-ufds-watcher` is usually in a maintenance state at this point and needs to be cleared.
    ```
    svcadm -z $(vmadm lookup alias=~sdc) clear napi-ufds-watcher
    ```

5. Test.

## Update Manta components

Manta will not always be deployed, so you can skip these steps if you do not have a Manta.

1. Update Manta webapi and authcache for each headnode in us-east-1, us-east-2, and us-east-3:
```
source /usbkey/config
mdash=$(sdc-sapi /services?name=marlin-dashboard\&include_master=true | json -Ha uuid) json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${ufds_ldap_root_pw}") sdc-sapi /services/$mdash -X PUT -d "$json"

madtom=$(sdc-sapi /services?name=madtom\&include_master=true | json -Ha uuid) json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${ufds_ldap_root_pw}") sdc-sapi /services/$madtom -X PUT -d "$json" ```
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

### End the data center maintenance
```
sdcadm dc-maint stop
# confirm status
sdcadm dc-maint status
```
