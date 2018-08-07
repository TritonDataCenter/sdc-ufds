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

- **Determine whether you have enabled UFDS replication**. Parts of this guide assume that you have already enabled UFDS replication using the `sdc-ufds-m2s` script. If you have not set up UFDS replication, follow the steps for the UFDS primary. You may skip all sections that refer to replicas.

- **Generate passwords**. You may use a single password for all data centers because they have the same content. You may also use a unique password per data center. If you use unique passwords, then all replica data centers must use the primary's password as the remote password.

    If you are unsure which data center is the primary, check `/usbkey/config` on the headnode for the line `ufds_is_master=true`.

- **Prepare to monitor UFDS log files**. Monitor the logs while making the changes is a best practice to catch anything that might go wrong.

    - To monitor the primary:

    ```
    tail -1f $(svcs -L ufds-master | bunyan
    ```

    - To monitor the `ufds-replicator` log:

    ```
    tail -1f $(svcs -L ufds-replicator)
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

2. Update `/usbkey/config` and `/mnt/usbkey/config` to set `ufds_ldap_root_pw` to the new `<REPLICA_PW>`.

3. Run `sdc-usbkey unmount`.

4. Modify the local UFDS password to the new password.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<REPLICA_PW>
    ```

5. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi` to ensure that the new password takes effect.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
        echo "restarting $uuid"
        vmadm reboot $uuid
    done
    ```

6. Restart the `ufds-capi` service in the `ufds` zone.

    ```
    svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
    ```

7. Restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```
    svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
    ```

8. Update the Manta authcache UFDS password stored in the `sapi` instance metadata, and then reboot the zone.

    ```
    sapiadm update $(sdc-vmname mahi) metadata.UFDS_ROOT_PW=<LOCAL_UFDS_PW>
    vmadm reboot $(sdc-vmname mahi)
    ```

### On the UFDS primary

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<PRIMARY_PW>`.

3. Run `sdc-usbkey unmount`.

4. Update the UFDS password to the new password `<PRIMARY_PW>`.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<PRIMARY_PW>
    ```

5. Reboot ```cloudapi```, ```mahi```, ```adminui```, and ```fwapi```.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
        echo "restarting $uuid"
        vmadm reboot $uuid
    done
    ```

6. Restart the `ufds-capi` service in the `ufds` zone.

    ```
    svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
    ```

7. Restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```
    svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
    ```

8. Update the password in the Manta authcache zone.

9. Test.

### Portal and sdcsso

Sdcsso is an optional component of the Triton Service Portal. SSO/portal steps are only necessary if they have been installed through a support contract.

- To update sdcsso:
    - In the sdcsso zone, edit `/opt/smartdc/sdcsso/cfg/config.json`.
    - Restart the `sdcsso` service.

- To update each of the portal instances:
    - In the portal installation directory, edit `/site/config/config.pro.json`.
    - Restart the `portal` service.

### On each replica data center

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<REMOTE_PW>`.

3. Run `sdc-usbkey unmount`.

4. Set the remote UFDS password to match the new password for the UFDS primary.

    ```
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<REMOTE_PW>
    ```

5. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi`.

    ```
    for uuid in $(sdcadm insts -j cloudapi adminui mahi fwapi | json -a zonename); do
      echo "restarting $uuid"
      vmadm reboot $uuid
    done
    ```

6. Restart the `capi` service in the `ufds` zone.

    ```
    svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
    ```

    At this point, the `napi-ufds-watcher` will need to be restarted. However, if it is in maintenance, you can  simply clear it.

7. To restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```
    svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
    ```

    If the `napi-ufds-watcher` is in a maintenance state, you can clear it by running:

    ```
    svcadm -z $(vmadm lookup alias=~sdc) clear napi-ufds-watcher
    ```

8. Test.

## Update Manta components

Manta will not always be deployed. If there is no Manta, skip these steps.

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
## Testing

1. Test all affected functions, including:
    - `CRUD account/sub-user/role`
    - `provisioning`
    - `list firewall rules`
    -  Manta CLI

2. Check CNS to ensure it automatically picks up the password change.

3. Check that the `ufds-master` service logs in the `ufds` zone don't have any connection errors. Connection errors indicate that some consumers still have the old password.