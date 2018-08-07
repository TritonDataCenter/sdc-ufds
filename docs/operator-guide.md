# UFDS Credential Rotation

UFDS key rotation impacts multiple feature areas and requires about an hour to complete from start to finish.

The functional areas impacted during the change window include:

- authentication for Triton, Manta API, and the Triton Service portal
- smartlogin
- account CRUD and fabric creation
- firewall rule CRUD

## Procedure summary

The high-level steps are as follows:

1. Update the data centers that have UFDS replicas by:
    - Setting a new, local UFDS password.
    - Configuring the passwords so they still talk to the UFDS primary using the current password. During this stage, only the data center being updated is impacted.

2. Update the data center containing the UFDS primary by:
    - Setting a new, local UFDS password. Once this is done, all services pointing to the UFDS primary will not work. These services include all `ufds-replicators`, sso, and cloudapi/adminui requests that write to UFDS.
    - Updating the remote UFDS password on each data center that has UFDS replicas.

### Before you begin

- Make sure that you have the unique passwords ready.

    Each data center has a local password. One data center is the primary. All other data centers are replicas. The primary data center's local password is also the remote password for all the replica data centers. All data centers replicate from the same primary data center, though exceptions to this are possible.

    Ops recommends that all data centers use the same password. However, you can choose a different password for each replica. That is, every data center may have a unique password.

    Every replica data center's remote password is the same as the primary data center's local password.

- Locate the four log files that contain `ufds-master`. You can find the names by running:

    ```
    svcs -L ufds-master
    ```

- Check each file by running:

    ```
    tail -1f $(svcs -L ufds-master) | bunyan
    ```

## Procedure

### Start data center maintenance:

    ```
    sdcadm dc-maint start --message="This DC is in maintenance."

    # confirm status
    sdcadm dc-maint status
    ```

### On each data center that has a UFDS replica

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config and /mnt/usbkey/config` to set `ufds_ldap_root_pw` to the new `<REPLICA_PW>`, and then unmount the usbkey:

    ```
    sdc-usbkey unmount
    ```

3. Modify the local UFDS password to the new password.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<REPLICA_PW>
    ```

4. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi` to ensure that the new password takes effect.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
        echo "restarting $uuid"
        vmadm reboot $uuid
    done
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
	
#### Testing

1. Test all affected functions, including:
    - `CRUD account/sub-user/role`
    - `provisioning`
    - `list firewall rules`
    -  Manta CLI

2. Check CNS to ensure it automatically picks up the password change.

3. Check that the `ufds-master` service logs in the `ufds` zone don't have any connection errors. Connection errors indicate that some consumers still have the old password.

### On the UFDS primary

1. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<PRIMARY_PW>`.

2. Update the UFDS password to the new password `<PRIMARY_PW>`.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<PRIMARY_PW>
    ```

3. Reboot ```cloudapi```, ```mahi```, ```adminui```, and ```fwapi```.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
        echo "restarting $uuid"
        vmadm reboot $uuid
    done
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

### Portal and sdcsso

Sdcsso is an optional component of the Triton Service Portal. SSO/portal steps are only necessary if they have been installed through a support contract.
- To update sdcsso:
    - In the sdcsso zone, edit `/opt/smartdc/sdcsso/cfg/config.json`, and then restart the `sdcsso` service.
- To update each of the portal instances:
    - In the portal installation directory, edit `/site/config/config.pro.json`, and then restart the `portal` service.

### On each data center

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config and /mnt/usbkey/config` to set `ufds_ldap_root_pw` to the new `<REMOTE_PW>`, and then unmount the usbkey:

    ```
    sdc-usbkey unmount
    ```

1. Set the remote UFDS password to match the new password for the UFDS primary.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<REMOTE_PW>
    ```

2. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi`.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
      echo "restarting $uuid"
      vmadm reboot $uuid
    done
    ```

3. Restart the `capi` service in the `ufds` zone.

    ```
    svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
    ```

    At this point, the `napi-ufds-watcher` will need to be restarted. However, if it is in maintenance, you can  simply clear it.

4. To restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```
    svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
    ```

    If the `napi-ufds-watcher` is in a maintenance state, you can clear it by running:

    ```
    svcadm -z $(vmadm lookup alias=~sdc) clear napi-ufds-watcher
    ```

5. Test.

## Update Manta components

Manta will not always be deployed, so you can skip these steps if you do not have a Manta.

1. Update Manta webapi and authcache for each data center:

    ```
    webapi=( $(manta-adm show -Ho zonename webapi) )

    for api in "${webapi[@]}"; do
      sapiadm update "$api" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
    done

    mahi=( $(manta-adm show -Ho zonename authcache) )

    for m in "${mahi[@]}"; do
      sapiadm update "$m" metadata.UFDS_ROOT_PW="${ufds_ldap_root_pw}"
    manta-oneach -z "$m" reboot
    done
    ```

2. Update madtom and marlin-dashboard.

    ```
    mdash=$(sdc-sapi /services?name=marlin-dashboard\&include_master=true | json -Ha uuid) json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${ufds_ldap_root_pw}") sdc-sapi /services/$mdash -X PUT -d "$json"

    madtom=$(sdc-sapi /services?name=madtom\&include_master=true | json -Ha uuid) json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${ufds_ldap_root_pw}") sdc-sapi /services/$madtom -X PUT -d "$json"
    ```

### End the data center maintenance

    ```
    sdcadm dc-maint stop
    # confirm status
    sdcadm dc-maint status
    ```
