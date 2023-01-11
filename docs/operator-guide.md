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
    - Configuring the passwords so they still talk to the UFDS primary using the current password. During this stage, only the replica data center being updated is impacted.

2. Update the data center containing the UFDS primary by:
    - Setting a new, local UFDS password. Once this is done, all services connecting to the UFDS primary will no longer work. These services include, but is not limited to, all `ufds-replicators`, portal, and cloudapi/adminui requests that write to UFDS.
    - Updating the remote UFDS password on each data center that has UFDS replicas.

### Before you begin

- **Determine whether you have enabled UFDS replication**. Parts of this guide assume that you have already enabled UFDS replication using the `sdc-ufds-m2s` script. If you have not set up UFDS replication, follow the steps for the UFDS primary only. Skip all sections that refer to replicas.

- **Generate passwords**. You may use a single password for all data centers because they have the same content. You may also use a unique password per data center. If you use unique passwords, then all replica data centers must use the primary's password as the remote password.

    If you are unsure which data center is the primary, check `/usbkey/config` on the headnode for the line `ufds_is_master=true`. There should be only *one* datacenter with this setting. If for some reason you have more than one data center with `ufds_is_master=true` and are unsure how to proceed, contact Triton support.

- **Prepare to monitor UFDS log files**. Monitor the logs while making the changes is a best practice to catch anything that might go wrong.

    Each of these commands are run from the UFDS zone.

    ```sh
    sdc-login -l ufds
    ```

  - To monitor the UFDS application log (all datacenters):

    ```sh
    tail -1f $(svcs -L ufds-master) | bunyan
    ```

  - To monitor the replication log (replicas only):

    ```sh
    tail -1f $(svcs -L ufds-replicator) | bunyan
    ```

## Procedure

### Start data center maintenance

These commands are run from the headnode global zone.

```sh
sdcadm dc-maint start --message="This DC is in maintenance."

# confirm status
sdcadm dc-maint status
```

### On each data center that has a UFDS replica

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config` and `/mnt/usbkey/config` to set `ufds_ldap_root_pw` to the new `<REPLICA_PW>`.

3. Run `sdc-usbkey unmount`.

4. Modify the local UFDS password to the new password.

    ```sh
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<REPLICA_PW>
    ```

5. Reboot `cloudapi`, `mahi`, `adminui`, `fwapi`, and `imgapi` to ensure that the new password takes effect.

    ```sh
    for inst in $(sdcadm insts -Ho instance cloudapi adminui mahi fwapi imgapi); do
      sdc-vmadm reboot "$inst"
    done
    ```

6. Restart the `ufds-capi` service in the `ufds` zone.

    ```sh
    svcadm -z $(vmadm lookup alias=~ufds) restart ufds-capi
    ```

7. Restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```sh
    svcadm -z $(vmadm lookup alias=~sdc) restart napi-ufds-watcher
    ```

#### Test the modifications

1. Test all affected features:
    - CRUD account/sub-user/role
    - provisioning
    - list firewall rules
    - Manta CLI

2. Check CNS to ensure that it automatically picks up the password change.

3. Check that that the `ufds-master` log doesn't have any connection errors. Connection errors indicate that some consumers still have the old password.

### On the UFDS primary

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<PRIMARY_PW>`.

3. Run `sdc-usbkey unmount`.

4. Update the UFDS password to the new password `<PRIMARY_PW>`.

    ```sh
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_ldap_root_pw=<PRIMARY_PW>
    ```

5. Reboot `cloudapi`, `mahi`, `adminui`, `imgapi`, and `fwapi`.

    ```sh
    for inst in $(sdcadm insts -Ho instance cloudapi adminui mahi fwapi imgapi); do
      sdc-vmadm reboot "$inst"
    done
    ```

6. Restart the `ufds-capi` service in the `ufds` zone.

    ```sh
    svcadm -z $(sdc-vmname ufds) restart ufds-capi
    ```

7. Restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```sh
    svcadm -z $(sdc-vmname sdc) restart napi-ufds-watcher
    ```

8. Test.

#### Portal

- To update each of the portal instances:
  - In the portal installation directory, edit `/site/config/config.pro.json`.
  - Restart the `portal` service.

Note: Any other 2nd or 3rd party applications that connect directly to UFDS
should also be updated at this time. This may include things like billing
processing services or 3rd party LDAP bridges.

### On each replica data center

1. Run `sdc-usbkey mount`.

2. Update `/usbkey/config` and `/mnt/usbkey/config` and set `ufds_ldap_root_pw` to the new `<LOCAL_PW>`.

3. Run `sdc-usbkey unmount`.

4. Set the remote UFDS password to match the new password for the UFDS primary.

    ```sh
    sapiadm update $(sdc-sapi /applications?name=sdc | json -Ha uuid) metadata.ufds_remote_ldap_root_pw=<LOCAL_PW>
    ```

5. Reboot `cloudapi`, `mahi`, `adminui`, and `fwapi`.

    ```sh
    for inst in $(sdcadm insts -Ho instance cloudapi adminui mahi fwapi imgapi); do
      sdc-vmadm reboot "$inst"
    done
    ```

6. Restart the `capi` service in the `ufds` zone.

    ```sh
    svcadm -z $(sdc-vmname ufds) restart ufds-capi
    ```

    At this point, the `napi-ufds-watcher` will need to be restarted. However, if it is in maintenance, you can  simply clear it.

7. To restart the `napi-ufds-watcher` service in the `sdc` zone.

    ```sh
    svcadm -z $(sdc-vmname sdc) restart napi-ufds-watcher
    ```

    If the `napi-ufds-watcher` is in a maintenance state, you can clear it by running:

    ```sh
    svcadm -z $(sdc-vmname sdc) clear napi-ufds-watcher
    ```

8. Test.

## Update Manta components

Manta will not always be deployed. If there is no Manta, skip these steps.

Before beginning, load the config into your current shell. This sets the
variable `CONFIG_ufds_ldap_root_pw` which will be used in each of these commands.

```sh
. /lib/sdc/config.sh
load_sdc_config
```

1. Update Manta webapi and authcache for each data center:

    Webapi

    ```sh
    webapi=( $(manta-adm show -Ho zonename webapi) )

    for api in "${webapi[@]}"; do
      sapiadm update "$api" metadata.UFDS_ROOT_PW="${CONFIG_ufds_ldap_root_pw}"
    done
    ```

    Check that all webapi instances have the correct passowrd. It may take a
    few moments for config-agent to update the config so you may need to check
    several times before all instances are up to date.

    ```sh
    manta-oneach -s webapi 'json -f /opt/smartdc/muskie/etc/config.json ufds.bindPassword'
    ```

    Authcache

    ```sh
    mahi=( $(manta-adm show -Ho zonename authcache) )

    for m in "${mahi[@]}"; do
      sapiadm update "$m" metadata.UFDS_ROOT_PW="${CONFIG_ufds_ldap_root_pw}"
      manta-oneach -z "$m" reboot
    done
    ```

    Authcache instances will automatically be up to date after the instance is
    rebooted in the previous step.

2. Update madtom and marlin-dashboard. This only applies to MantaV1.

    ```sh
    mdash=$(sdc-sapi /services?name=marlin-dashboard\&include_master=true | json -Ha uuid)
    json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${CONFIG_ufds_ldap_root_pw}")
    sdc-sapi /services/$mdash -X PUT -d "$json"

    madtom=$(sdc-sapi /services?name=madtom\&include_master=true | json -Ha uuid)
    json=$(printf '{"metadata":{"UFDS_ROOT_PW":"%s"}}' "${CONFIG_ufds_ldap_root_pw}")
    sdc-sapi /services/$madtom -X PUT -d "$json"
    ```

3. Locate any reshard zone in the DC and update its metadata. This only applies
   to MantaV2.

   The reshard service is experimental and you should not have one unless you
   were explicitly instructed to create one by Triton support.

   There should only be one reshard zone in each region:

    ```sh
    reshard=$(manta-adm show -Ho zonename reshard)
    json=$(printf '{"action":"update","metadata":{"UFDS_ROOT_PW": "%s"}}' "${CONFIG_ufds_ldap_root_pw}"
    sdc-sapi /instances/$reshard -X PUT -d "$json"
    ```

### End the data center maintenance

```sh
sdcadm dc-maint stop
# confirm status
sdcadm dc-maint status
```

## Testing

1. Test all affected functions, including:
    - `CRUD account/sub-user/role`
    - `provisioning`
    - `list firewall rules`
    - Manta CLI

2. Check CNS to ensure it automatically picks up the password change.

3. Check that the `ufds-master` service logs in the `ufds` zone don't have any connection errors. Connection errors indicate that some consumers still have the old password.
