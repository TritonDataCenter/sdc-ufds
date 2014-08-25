#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

role=ufds
SVC_ROOT="/opt/smartdc/$role"
PATH=/opt/smartdc/ufds/build/node/bin:/opt/smartdc/ufds/node_modules/.bin:/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

# Local manifests
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/ufds

# Install UFDS
mkdir -p /opt/smartdc/ufds/ssl
chown -R nobody:nobody /opt/smartdc/ufds

echo "Generating SSL Certificate"
/opt/local/bin/openssl req -x509 -nodes -subj '/CN=*' -newkey rsa:2048 \
    -keyout /opt/smartdc/ufds/ssl/key.pem -out /opt/smartdc/ufds/ssl/cert.pem \
    -days 3650

# Gather metadata needed for setup
UFDS_ADMIN_IP=127.0.0.1
UFDS_LDAP_ROOT_DN=$(json -f ${METADATA} ufds_ldap_root_dn)
UFDS_LDAP_ROOT_PW=$(json -f ${METADATA} ufds_ldap_root_pw)
IS_MASTER=$(cat /opt/smartdc/ufds/etc/config.json | /usr/bin/json ufds_is_master)


# NOTE: this was moved here from configure where it used to live and be called
# from configure.  There doesn't seem to be a good reason to import the manifest
# on every boot.
LDAPTLS_REQCERT=allow


function setup_ufds {
    local ufds_instances=4

    #Build the list of ports.  That'll be used for everything else.
    local ports
    for (( i=1; i<=$ufds_instances; i++ )); do
        ports[$i]=`expr 1389 + $i`
    done

    #To preserve whitespace in echo commands...
    IFS='%'

    #haproxy
    for port in "${ports[@]}"; do
        hainstances="$hainstances        server ufds-$port 127.0.0.1:$port check inter 10s slowstart 10s error-limit 3 on-error mark-down\n"
    done

    sed -e "s#@@UFDS_INSTANCES@@#$hainstances#g" \
        $SVC_ROOT/etc/haproxy.cfg.in > $SVC_ROOT/etc/haproxy.cfg || \
        fatal "could not process $src to $dest"

    sed -e "s/@@PREFIX@@/\/opt\/smartdc\/ufds/g" \
        $SVC_ROOT/smf/manifests/haproxy.xml.in > $SVC_ROOT/smf/manifests/haproxy.xml || \
        fatal "could not process $src to $dest"

    svccfg import $SVC_ROOT/smf/manifests/haproxy.xml || \
        fatal "unable to import haproxy"
    svcadm enable "ufds/haproxy" || fatal "unable to start haproxy"

    #ufds instances
    local ufds_xml_in=$SVC_ROOT/smf/manifests/ufds-master.xml.in
    for port in "${ports[@]}"; do
        local ufds_instance="ufds-$port"
        local ufds_xml_out=$SVC_ROOT/smf/manifests/ufds-$port.xml
        sed -e "s#@@UFDS_PORT@@#$port#g" \
            -e "s#@@UFDS_INSTANCE_NAME@@#$ufds_instance#g" \
            -e "s/@@PREFIX@@/\/opt\/smartdc\/ufds/g" \
            $ufds_xml_in  > $ufds_xml_out || \
            fatal "could not process $ufds_xml_in to $ufds_xml_out"

        svccfg import $ufds_xml_out || \
            fatal "unable to import $ufds_instance: $ufds_xml_out"
        svcadm enable "$ufds_instance" || \
            fatal "unable to start $ufds_instance"
    done

    unset IFS
}


setup_ufds

function setup_haproxy_rsyslogd {
    #rsyslog was already set up by common setup- this will overwrite the
    # config and restart since we want haproxy to log locally.

    echo "Updating /etc/rsyslog.conf"
    mkdir -p /var/tmp/rsyslog/work
    chmod 777 /var/tmp/rsyslog/work

    cat > /etc/rsyslog.conf <<"HERE"
$MaxMessageSize 64k

$ModLoad immark
$ModLoad imsolaris
$ModLoad imudp

*.err;kern.notice;auth.notice                   /dev/sysmsg
*.err;kern.debug;daemon.notice;mail.crit        /var/adm/messages

*.alert;kern.err;daemon.err                     operator
*.alert                                         root

*.emerg                                         *

mail.debug                                      /var/log/syslog

auth.info                                       /var/log/auth.log
mail.info                                       /var/log/postfix.log

$WorkDirectory /var/tmp/rsyslog/work
$ActionQueueType Direct
$ActionQueueFileName sdcfwd
$ActionResumeRetryCount -1
$ActionQueueSaveOnShutdown on

# Support node bunyan logs going to local0
local0.* /var/log/haproxy.log

$UDPServerAddress 127.0.0.1
$UDPServerRun 514
HERE


    svcadm restart system-log
    [[ $? -eq 0 ]] || fatal "Unable to restart rsyslog"

    logadm -w /var/log/haproxy.log -C 5 -c -s 100m
}

setup_haproxy_rsyslogd

echo "Importing CAPI SMF Manifest"
/usr/sbin/svccfg import /opt/smartdc/$role/smf/manifests/$role-capi.xml

# We are intentionally giving UFDS service some room to create the required
# moray buckets before it gets called to add bootstrap data.
# XXX: do we still need to do this?
sleep 10

echo "Adding log rotation"
sdc_log_rotation_add amon-agent /var/svc/log/*amon-agent*.log 1g
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add ufds-master-1390 /var/svc/log/*ufds-1390*.log 1g
sdc_log_rotation_add ufds-master-1391 /var/svc/log/*ufds-1391*.log 1g
sdc_log_rotation_add ufds-master-1392 /var/svc/log/*ufds-1392*.log 1g
sdc_log_rotation_add ufds-master-1393 /var/svc/log/*ufds-1393*.log 1g
sdc_log_rotation_add ufds-capi /var/svc/log/*ufds-capi*.log 1g
sdc_log_rotation_add ufds-replicator /var/svc/log/*ufds-replicator*.log 1g
sdc_log_rotation_setup_end

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=/opt/smartdc/$role/build/node/bin:/opt/smartdc/$role/node_modules/.bin:\$PATH" >>/root/.profile

# Wait up to 50s for UFDS to come up to load bootstrap data.
echo "Wait for ufds service to come online."
for i in 0 1 2 3 4 5 6 7 8 9; do
    echo "Is ufds up? (i=$i)"
    LDAPTLS_REQCERT=allow ldapwhoami \
        -H ldaps://${UFDS_ADMIN_IP} -x \
        -D ${UFDS_LDAP_ROOT_DN} -w ${UFDS_LDAP_ROOT_PW} \
        && break || true
    sleep 5
done

LDAPTLS_REQCERT=allow ldapwhoami -H ldaps://${UFDS_ADMIN_IP} -x \
    -D ${UFDS_LDAP_ROOT_DN} -w ${UFDS_LDAP_ROOT_PW}
if [[ $? -ne 0 ]]; then
    echo "Timeout waiting for ufds to come up."
    echo "Marking ufds SMF service as in maintenance."
    svcadm mark maintenance svc:/smartdc/application/ufds-master:ufds-1390
    svcadm mark maintenance svc:/smartdc/application/ufds-master:ufds-1391
    svcadm mark maintenance svc:/smartdc/application/ufds-master:ufds-1392
    svcadm mark maintenance svc:/smartdc/application/ufds-master:ufds-1393
    exit 1
fi

echo "Reconciling/bootstrapping data"
/opt/smartdc/$role/bin/ufds-reconcile-data
if [[ $? -ne 0 ]]; then
    echo "Unable to reconcile/bootstrap ufds data."
    exit 1
fi

# Only now start the replicator.  We don't start it until now because it stores
# the checkpoint in the local ufds under a tree that was added during reconcile/
# bootstrap
if [[ "${IS_MASTER}" == "false" ]]; then
    echo "Importing UFDS Replicator SMF Manifest"
    /usr/sbin/svccfg import /opt/smartdc/$role/smf/manifests/$role-replicator.xml
fi

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
