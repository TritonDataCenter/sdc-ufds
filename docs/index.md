---
title: UFDS
mediaroot: ./media
apisections: SmartDataCenter Tree, Changelog, CAPI
markdown2extras: tables, code-friendly
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# UFDS

UFDS is the "unified foundational directory service" built for SDC over
[ldapjs](http://ldapjs.org) and [Moray](https://github.com/joyent/moray),
and is used to track accounts, credentials, and more. It is a superset of
functionality offered by previous SDC versions employing CAPI (there is a
backwards compatible "shim" that offers the same API as CAPI did in SDC 6.5).

This document does not really discuss any generic-LDAP things, but
really just the SDC-specific uses of it.

# SmartDataCenter Tree

The directory tree is laid out as follows:

    o=smartdc
      +-ou=users
      |  +-uuid=:uuid
      |  | +-key=:fingerprint
      |  | +-metadata=:appkey
      |  | +-dclimit=:datacenter
      |  | +-amonprobegroup=:uuid
      |  | +-amonprobe=:uuid
      |  | +-cn=pwdpolicy
      |  | +-uuid=:uuid
      |  |  | +-key=:fingerprint
      |  | +-policy-uuid=:uuid
      |  | +-group-uuid=:uuid
      |  | +-dclocalconfig=:datacenter
      +-ou=groups
      |  +-cn=:name
      +-cn=pwdpolicy
      +-cn=blacklist
      +-datacenter=:name
      |  +-cn=replicator
      +-ou=images
      |  +-uuid=:uuid
      +-ou=fwrules
      |  +-uuid=:uuid
      +-ou=packages
      |  +-uuid=:uuid


Basically main "subtrees" are about users and group information, while the
other "subtrees" are related to headnode/datacenter configuration.

Reference the files in `./schema` for an up to date list of attributes
et al. This is just high-level information on what you can look for.



## Users (sdcPerson)

The `sdcPerson` type is one of the `uuid=:uuid, ou=users, o=smartdc`
entries, and contains all the attributes for a "user".
These objects should always be stored by uuid.  Here's the
bootstrapped user:

    dn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc
    cn: Admin
    email: root@localhost
    login: admin
    objectclass: sdcperson
    sn: User
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853

Please, note that login and email values may be different, given they are part
of the headnode configuration.

All the attributes starting with `pwd` are related to password policy. Unlike
the attributes beginning with and underscore, the password policy related
attributes are not hidden

## Instance Types / Packages (sdcPackage)

<div class="intro">
Please, note we're in the process to move <code>sdcPackages</code> into their own dedicated
API. Updated info at the new <a href="https://github.com/joyent/sdc-papi" title="PAPI">Packages API</a>
documentation.
</div>

The `sdcPackage` type is one of the `uuid=:uuid, ou=packages, o=smartdc`
entries, and contains all the attributes for a "package".
These objects should always be stored by uuid.  Here's an example of
an instance type:

    dn: uuid=7fc87f43-2def-4e6f-9f8c-980b0385b36e, ou=packages, o=smartdc
    uuid: 7fc87f43-2def-4e6f-9f8c-980b0385b36e
    active: true
    cpu_cap: 25
    default: false
    group: Standard
    description: Micro 0.25 GB RAM 0.125 CPUs 16 GB Disk
    max_lwps: 4000
    max_physical_memory: 256
    max_swap: 512
    name: g3-standard-0.25-smartos
    common_name: Standard 0.25
    quota: 16384
    networks: ["1e7bb0e1-25a9-43b6-bb19-f79ae9540b39", "193d6804-256c-4e89-a4cd-46f045959993"]
    version: 1.0.0
    zfs_io_priority: 100
    fss: 25.0625
    cpu_burst_ratio: 0.5
    ram_ratio: 1.995012469
    overprovision_cpu: 2
    overprovision_memory: 1
    objectclass: sdcPackage



| Attribute              | Required                           | Explanation                                                                                                                                                                                        |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| uuid                   | Mandatory                          | UUID for the sdcPackage                                                                                                                                                                            |
| owner\_uuid            | Optional                           | UUID of the owner of this sdcPackage                                                                                                                                                               |
| active                 | Mandatory                          | is this provisionable: true or false                                                                                                                                                               |
| vcpus                  | Mandatory if type == kvm           | number of cpus to show, Integer 1 - 64                                                                                                                                                             |
| cpu\_cap               | Mandatory                          | CPU CAP,Integer 20-1000, formula: VCPU * Bursting Ratio * OverProvision Ratio * 100 + (vCPU <= 1 ? 50: 100)                                                                                        |
| default                | Mandatory                          | is this the default instance type: true or false                                                                                                                                                   |
| group                  | Mandatory                          | group of associated instance types, either: Standard, High CPU, High Memory, High Storage, High IO or the Customer's Name                                                                          |
| description            | Mandatory                          | description of this instance type                                                                                                                                                                  |
| max\_lwps              | Mandatory                          | max processes, Integer                                                                                                                                                                             |
| max\_physical_memory   | Mandatory                          | max RAM in MB, Integer                                                                                                                                                                             |
| max\_swap              | Mandatory                          | max SWAP in MB, Integer                                                                                                                                                                            |
| name                   | Mandatory                          | API name, using this formula: [version]-[familyname]-[RAM GB]-[type]-[flags], version is currently g3, familyname is group, type is either smartos or kvm, flags is to catch cluster computes (cc) |
| common\_name           | Mandatory                          | Name displayed in the Portal                                                                                                                                                                       |
| quota                  | Mandatory                          | disk size in MB                                                                                                                                                                                    |
| networks               | Optional                           | List of networks to associate with                                                                                                                                                                 |
| version                | Mandatory                          | semver version number                                                                                                                                                                              |
| parent                 | Mandatory, if created for customer | API name of the instance type this was cloned from                                                                                                                                                 |
| traits                 | Optional                           | set of traits for provisioning, currently limited to ssd:true and storage:true by current server installation                                                                                      |
| zfs\_io\_priority      | Mandatory                          | ZFS IO Priority, Integer 0 - 1000                                                                                                                                                                  |
| fss                    | Mandatory                          | Typically computed value, formula: OverProvision Ratio == 1 ? CPU\_CAP: (Guest DRAM/Host DRAM provisionable) * Host CPUs * 100                                                                     |
| cpu\_burst\_ratio      | Optional                           | Typically computed value, formula: (CPU\_CAP / (OverProvision Ratio * Burst Ratio))/FSS                                                                                                            |
| ram\_ratio             | Optional                           | Typically computed value, formula: RAM GB/((CPU\_CAP/100)\*Bursting Ratio * OverProvision Ratio)                                                                                                   |
| overprovision\_cpu     | Optional                           | Overprovision CPU, 1=don't overprovision, 2=overprovision                                                                                                                                          |
| overprovision\_memory  | Optional                           | Overprovision Memory, 1=don't overprovision, 2=overprovision                                                                                                                                       |
| overprovision\_storage | Optional                           | Overprovision Storage, 1=don't overprovision, 2=overprovision                                                                                                                                      |
| overprovision\_network | Optional                           | Overprovision Network, 1=don't overprovision, 2=overprovision                                                                                                                                      |
| overprovision\_io      | Optional                           | Overprovision IO, 1=don't overprovision, 2=overprovision                                                                                                                                           |


## SSH Keys (sdcKey)

The `sdcKey` objectclass holds SSH keys for tenants, as well as the
OpenSSL compatible form of the SSH key (to support signing).  While
these objects have a `name` field, they are stored by fingerprint, and
CloudAPI works with either `name` or `fingerprint` as the URL.
(Indeed, SmartDC 7 uses keys `fingerprint` also as `name` attribute when
a `name` is not specified).

DN for the sdcKey object type is: `fingerprint=:fingerprint, uuid=:uuid, ou=users, o=smartdc`

## Password Policy (pwdPolicy)

`pwdpolicy` is related to PCI Compliance, and is a partial implementation
of IETF draft [Password Policy for LDAP Directories](http://tools.ietf.org/html/draft-behera-ldap-password-policy-10).

Concretely, the following PCI restrictions are implemented through the global
`cn=pwdpolicy, o=smartdc` object:

- passwords expire at least every 90 days
- passwords must be at least 7 characters long
- passwords must have both alpha & numeric characters.
- passwords cannot be re-used. A new password cannot match the 4 previous
  passwords.
- customers are locked out after 6 failed login attempts.
- customers are locked out for 30 minutes or until reset. The user could
  regain the ability to login if they contact support or use the password
  reset form from Customer Portal/SSO.

Note that it's possible to set an specific password policy sub-entry for a
given `sdcPerson` entry. Elements of this sub-entry would have the `dn` of
`cn=pwdpolicy, uuid=:uuid, ou=users, o=smartdc` and the `sdcPerson` entry
associated with this password policy entry will point to the `dn` through
the `sdcPerson` attribute `pwdPolicySubentry`.


## CAPI Specific Objects

These objects `objectclass` may change in future versions to remove the
legacy `capi` prefix.

### capiLimit

Holds a mapping of "limits" per dataset type in a particular
datacenter for a given `sdcPerson`.
Stored with `dclimit=:datacenter, uuid=:uuid, ou=users, o=smartdc` as the DN.

Refer to Cloud API `provision_limits` plugin documentation for a more detailed
description

### capiMetadata

It's just a free-form entry (meaning you can put any attribute/value pairs in
you want). Stored by `metadata=:appkey, ...`.

Actually, SSO/Portal use it to store PCI related information


## Email Black List

The object `emailblacklist` is intended to store the list of email addresses
disallowed to be used when a new `sdcPerson` entry is created. Both, complete
email addresses like `foo@example.com` or wildcards, like `*@example.com` are
valid values for the `email` attribute.


## UFDS as Object Storage

Several of the SDC 7 applications use UFDS as their storage mechanism of choice
among others to take advantage of the LDAP search facilities.

While it's possible to manipulate such values using raw LDAP commands, we
encourage you to do not add/modify/delete such entries but through the
different applications associated with each Object type:

| ObjectClass    | Application        |
| -------------- | ------------------ |
| sdcPackage     | AdminUI            |
| sdcImage       | ImageAPI           |
| amonprobegroup | Amon               |
| amonprobe      | Amon               |
| fwrule         | FWAPI              |
| vmusage        | VMAPI              |
| sdcreplicator  | UFDS configuration |


# Account Users, Groups and Policies

Starting with version 7.1 - `cat /opt/smartdc/ufds/package.json | json version`
into your ufds instance - an account, (a top level user, identified by the dn
`uuid=:uuid, ou=users, o=smartdc`), can hold an arbitrary number of sub-users
identified by `uuid=:uuid, uuid=:account, ou=users, o=smartdc` (where `:account`
is the UUID for the top level user), access policies, identified by
`policy-uuid=:uuid, uuid=:account, ou=users, o=smartdc` and groups, identified
by `group-uuid=:uuid, uuid=:account, ou=users, o=smartdc`.

Additionally, sub-users can also have their own SSH keys with the DN modified
accordingly if you compare with top level users:
`fingerprint=:fingerprint, uuid=:uuid, uuid=:account, ou=users, o=smartdc`


## Sub Users (sdcAccountUser)

An object with class `sdcAccountUser` has the same properties than a top level
`sdcPerson` (indeed, both object classes are added to these sub users). Apart of
the aforementioned difference on the DN, given the sub users are under the main
account entry into the LDAP tree, object of class `sdcAccountUser` have the
following additional properties:

- `account`: The UUID of the main account user
- `alias`: A duplicate of `login`. This value has been added for applications
  performing direct lookups into `ufds_o_smartdc` bucket using moray. The value
  for the `login` attributes of `sdcAccountUser` objects is always stored into
  this bucket using the pattern `AccountUUID/login` in order to be able to provide
  global login uniqueness while the same login is allowed for different accounts
  sub users. Behind the scenes, UFDS server does the back and forth transformations
  when somebody searches/adds new users but, obviously, this isn't the case for
  applications looking straight into moray's buckets.
- Multiple `objectclass` values: `sdcAccountUser` and `sdcPerson`.


        dn: uuid=155ff4f6-f7c8-427e-bad6-5a7fbaa1bd7d, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc
        account: 4bc1929f-dfc2-4c04-ae6c-0a388ee67f97
        email: a78960b9_test@joyent.com
        objectclass: sdcperson
        objectclass: sdcaccountuser
        uuid: 155ff4f6-f7c8-427e-bad6-5a7fbaa1bd7d
        pwdchangedtime: 1392655027670
        created_at: 1392655027348
        updated_at: 1392655027682
        approved_for_provisioning: false
        pwdendtime: 253406281855027680
        alias: a78960b9
        login: a78960b9
        phone: +34 626 626 626
        pwdhistory: 1392655027348#1.3.6.1.4.1.1466.115.121.1.40#40#{sha}885f65d3830a292aa46b6c656ff5212cf9e0da46

## Access Policies (sdcAccountPolicy)

Each account may have one or more `sdcAccountPolicy` entries. Appart of the
aforementioned `uuid` and `account` attributes, these entries have the following
properties:

- `name` (mandatory) and `description` (optional) of the entry.
- One or more `rule` values. These are different [Aperture](https://github.com/joyent/node-aperture)
  sentences. Note that **when more than one sentence is present, the [conditions](https://github.com/joyent/node-aperture#conditions)
  expressed by these sentences will be evaluated using `OR`**.
- One or more `memberrole` values. These will point to the DNs of the account
  roles linking to each policy. Please, note this value is **automatically added**
  when you add a link to a `sdcAccountPolicy` entry from any role.

        dn: policy-uuid=7c18cb44-a22c-4836-a1f4-9215a56871b7, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc
        uuid: 7c18cb44-a22c-4836-a1f4-9215a56871b7
        account: 4bc1929f-dfc2-4c04-ae6c-0a388ee67f97
        name: policy-name-can-be-modified
        description: This is completely optional
        objectclass: sdcaccountpolicy
        rule: ["Fred can read *.js when dirname = examples and sourceip = 10.0.0.0/8","Bob can read and write timesheet if requesttime::time > 07:30:00 and requesttime::time < 18:30:00 and requesttime::day in (Mon, Tue, Wed, THu, Fri)","John, Jack and Jane can ops_* *","Pedro can delete *"]
        memberrole: group-uuid=fe461981-0615-40ff-a537-f5edfc511b13, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc

## Roles (sdcAccountRole)

These are similar entries to the top level groups given they can also take
multipe sdcPerson values for the attribute `uniquemember`. The following is
the complete list of attributes for entries of class `sdcAccountRole`:

- `name` (mandatory) of the entry.
- `memberpolicy`: the DN for one or more `sdcAccountPolicy` entries linked from
  the role. (Again, note these values will be automatically updated by UFDS
  server when, for example, we delete one of the linked `sdcAccountPolicy` entries).
- `uniquemember`: DNs of the `sdcAccountUser` entries we want to include into
  this group.

        dn: group-uuid=fe461981-0615-40ff-a537-f5edfc511b13, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc
        account: 4bc1929f-dfc2-4c04-ae6c-0a388ee67f97
        name: role-name-can-be-modified
        objectclass: sdcaccountrole
        uniquemember: uuid=155ff4f6-f7c8-427e-bad6-5a7fbaa1bd7d, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc
        uniquemember: uuid=d8945574-c2c7-4e08-8fb9-a5f43281cdcb, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc
        uuid: fe461981-0615-40ff-a537-f5edfc511b13
        memberpolicy: policy-uuid=7c18cb44-a22c-4836-a1f4-9215a56871b7, uuid=4bc1929f-dfc2-4c04-ae6c-0a388ee67f97, ou=users, o=smartdc


## UFDS and CloudAPI mappings

Main difference between the way UFDS stores the information and
the way this information is displayed to customers through CloudAPI
is that while UFDS stores the whole DNs as the values of `uniquemember`
and `memberpolicy` attributes, the respective `members` and `policies`
attributes in CloudAPI take the list of `login` names for the users and
the list of `names` for the policies.

# Interacting with UFDS

UFDS LDAP server runs into headnode machine of the same name `ufds` and,
by default, it listens to all interfaces on `ldaps` port (636).

This machine has only admin interface, therefore the only way to interact with
the LDAP server is from this interface.

Easier way to interact with the LDAP server is using `sdc-ldap`, which is
merely a wrapper for the different LDAP commands with the UFDS LDAP server
address and the default authentication options already set.

`sdc-ldap` is available as part of the set of SDC 7 `headnode` set of tools.


    [root@headnode (coal) ~]# sdc-ldap search objectclass=sdcpackage name
    dn: uuid=0ea54d9d-8d4d-4959-a87e-bf47c0f61a47, ou=packages, o=smartdc
    name: sdc_64

    dn: uuid=73a1ca34-1e30-48c7-8681-70314a9c67d3, ou=packages, o=smartdc
    name: sdc_128

    dn: uuid=78aa629d-04fc-4ee5-881b-0b4a914e0c52, ou=packages, o=smartdc
    name: sdc_256

    dn: uuid=5dd022c8-5388-43e3-9fdd-536df4ea4f9f, ou=packages, o=smartdc
    name: sdc_512

    dn: uuid=1ee2a2ab-2138-8542-b563-a67bb03792f7, ou=packages, o=smartdc
    name: sdc_768

    dn: uuid=4769a8f9-de51-4c1e-885f-c3920cc68137, ou=packages, o=smartdc
    name: sdc_1024

    dn: uuid=8d205d81-3672-4297-b80f-7822eb6c998b, ou=packages, o=smartdc
    name: sdc_2048

    dn: uuid=b2cd4ca7-ad7f-4a98-adeb-7adc9978a875, ou=packages, o=smartdc
    name: sdc_db

    dn: ou=pkg, o=smartdc
    name: regular_128


## Unlock user

After 6 failed login attempts, an user account will get locked due to PCI
restrictions. While the account will be unlocked if the user follows the
password reset form in Portal, there's also the possibility to unlock the
account w/o modifying the password talking straight to the ldap server.

An user is locked when the `sdcPerson` entry has the attribute
`pwdaccountlockedtime` set, and that value is greater than the current time,
(it is set in a way the user will get automatically unlocked after 30 minutes).

To immediately unlock an user, the easier way is to save the user information
into a file and use ldap modify to remove the `pwdaccountlockedtime` attr. For
example, for an user with dn:

    uuid=298ef9d9-512e-419b-8dc2-915b7c99c75b, ou=users, o=smartdc

we'll save the information into a file `/tmp/298ef9d9-512e-419b-8dc2-915b7c99c75b.ldif`
including:

    dn: uuid=298ef9d9-512e-419b-8dc2-915b7c99c75b, ou=users, o=smartdc
    changetype: modify
    delete: pwdaccountlockedtime

and then modify the entry with:

    sdc-ldap modify -f /tmp/298ef9d9-512e-419b-8dc2-915b7c99c75b.ldif


Additionally, if an user password has expired, the user will have a `pwdendtime`
value smaller than the current time in milliseconds, and the account will be
locked. In order to remove this lock, the procedure above can also be used to
remove the `pwdendtime` value:

    dn: uuid=298ef9d9-512e-419b-8dc2-915b7c99c75b, ou=users, o=smartdc
    changetype: modify
    delete: pwdendtime


## Adding emails to blacklist

Save the information into the file `/tmp/blacklist.ldif`, and add the required
email addresses or wildcards as follow:

    dn: cn=blacklist, o=smartdc
    add: email
    email: foo@bar.com
    email: *@bar.com
    email: whatever@else.net

Then, add the modifications to the already existing `emailblacklist` with:

    sdc-ldap modify -f /tmp/blacklist.ldif

## Searching (effectively)

This is really important, so read this 2x if you have to!

To find a customer from the top of the tree, you're best off doing
something like `(&(login=markc)(objectclass=sdcperson))` or
`(&(email=mark.cavage@joyent.com)(objectclass=sdcperson))`.  That's
going to find you a record where you can then use the DN.  So, suppose
I found one where the DN was
`uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=operators,
o=smartdc`. I could then go ahead and (safely) use _any_ filter if I
retarget searches at that scope base.  This is because UFDS
automatically indexes all objects at or under a `uuid=...` entry with
the `_owner` attribute, and on searches will automagically add that
`_owner=$uuid` into your search filter.

So, once you're searching at or under a customer record, do whatever
you want. When searching from the top of the tree, only use equality
filters on indexed attributes (you can use an `and` filter, but one of
them really should be an equality match).

## Hidden attributes

UFDS stores a bunch of attributes prefixed with `_`.  For example,
`_mtime`, `_salt`, etc.  And, by default, UFDS will not return these
on searches (notably this includes `userpassword`).  To make UFDS
return these, you must (1) be an operator (or the actual admin), and
(2) you must pass in the "hiddenAttributes" control, which is
something Joyent invented.  The OID for this control is
'1.3.6.1.4.1.38678.1'. Here's an example search that shows all the attributes:


    $ ./bin/ldapjs-search -i -u ldaps://10.99.99.21 -D cn=root -w secret -c 1.3.6.1.4.1.38678.1 -b o=smartdc "(login=*)"
    [{
      "dn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=operators, o=smartdc",
      "cn": "Admin",
      "email": "user@joyent.com",
      "login": "admin",
      "objectclass": "sdcperson",
      "sn": "User",
      "userpassword": "d72f926f632784be67d1f96a4d82396c67ef5f5b",
      "uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "_salt": "51bcac43c05e9148744b151317351fd96d8d953f",
      "_owner": "930896af-bf8c-48d4-885c-6573a94b1853",
      "_mtime": "2011-10-25T16:45:08Z"
    }]


Note that all the `ldapjs` binaries are part of node ldapjs module. All of them
are in the path into the UFDS zone.

# Changelog

UFDS supports an almost-RFC compliant LDAP changelog, which will
always live at `cn=changelog`.  It contains all changes that have ever
happened in the directory.  You can search by `changetype`,
`changenumber` and `targetdn`.  Here's a sample record:

    dn: changenumber=1319561108253, cn=changelog
    targetdn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=operators, o=smartdc
    changetime: 2011-10-25T16:45:08Z
    changenumber: 1319561108253
    changetype: add
    changes: {"cn":["Admin"],"email":["user@joyent.com"],"login":["admin"],"object
     class":["sdcPerson"],"sn":["User"],"userpassword":"XXXXXX","uuid":["930896af-
     bf8c-48d4-885c-6573a94b1853"],"_salt":["51bcac43c05e9148744b151317351fd96d8d9
     53f"],"_owner":["930896af-bf8c-48d4-885c-6573a94b1853"]}
    objectclass: changeLogEntry

Here are sample searches using `sdc-ldap` wrapper:

    sdc-ldap search -b cn=changelog "(changetype=*)"
    sdc-ldap search -b cn=changelog "(changenumber>=50)"

The most usual changelog searches are those looking for all the changes made
over a given entry, known its DN:

    sdc-ldap search -b cn=changelog  targetdn='dclimit=us-west-1, uuid=458d9ce8-cb25-422d-be47-683a85052a86, ou=users, o=smartdc'

You can also using _wildcard_ into the `targetdn` attribute value to search
all changes with a target DN as base, for example

    sdc-ldap search -b cn=changelog  targetdn='*uuid=458d9ce8-cb25-422d-be47-683a85052a86, ou=users, o=smartdc'

would give you all changes made to every entry related to the account
identified by the DN `uuid=458d9ce8-cb25-422d-be47-683a85052a86, ou=users, o=smartdc`,
(limits, ssh keys, sub-users, roles, policies, ...), including the account
itself.

# Aliasing the OpenLDAP CLI

Do this, or your life will be far far away to be happy:

These are part of your headnode configuration, concretely `ufds_ldap_root_dn`
and `ufds_ldap_root_pw`:

    $ export LCREDS="-D cn=root -w secret"

UFDS admin IP is also set into that file. Pick first of `ufds_admin_ips` value:

    $ export LURL=ldaps://10.99.99.18

Then, alias the ldap commands as follow:

    $ alias lsearch='LDAPTLS_REQCERT=allow ldapsearch -x -LLL $LCREDS -H $LURL'
    $ alias ladd='LDAPTLS_REQCERT=allow ldapadd -x $LCREDS -H $LURL'
    $ alias lmodify='LDAPTLS_REQCERT=allow ldapmodify -x $LCREDS -H $LURL'
    $ alias ldelete='LDAPTLS_REQCERT=allow ldapdelete -x $LCREDS -H $LURL'

# CAPI (SDC 6.5 Backwards Compatibility)

To maintain backwards compatibility with SDC 6.5, there is a restify app that
"approximates" the old CAPI interface. It is running on the same host than UFDS

To make curl'ing the CAPI thing easier, I have a small bash function:

    function capi() {
        /usr/bin/curl -is -H 'Accept: application/json' -H 'content-type: application/xml' -u admin:tot@ls3crit --url http://localhost:8080$@ ;
        echo "";
    }

After that, reference the CAPI api at <http://apidocs.joyent.com/sdcapidoc/capi>.

But, here are some helpers for you:

### Customers

| Action   | Command                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| *create* | `capi /customers -d @/Users/mark/work/ufds/data/capi_customer.xml`                                               |
| *update* | `capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d -d @/Users/mark/work/ufds/data/update_customer.xml -X PUT` |
| *get*    | `capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d`                                                           |
| *list*   | `capi /customers`                                                                                                |
| *search* | `capi /customers?email_address=%40joyent.com`                                                                    |
| *delete* | `capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d -X DELETE`                                                 |

### SSH keys

| Action   | Command                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| *add*    | `/usr/bin/curl -is http://localhost:8080/customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d/keys --data-urlencode key@/Users/mark/.ssh/id_rsa.pub -d name=id_rsa` |
| *list*   | `capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys`                                                                                                   |
| *rename* | `capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys/7bc05cd69e110c76044b03c911f2727f?name=foo -X PUT`                                                  |
| *delete* | `capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys/7bc05cd69e110c76044b03c911f2727f -X DELETE`                                                        |

# Using Bcrypt to encrypt passwords

While UFDS can use `bcrypt` to encrypt users passwords, it's recommended to
do not use it on those cases where any SDC 6.5 application is trying to
authenticate users through `capi-shim`.

The reason is that legacy 6.5 applications will assume that encryption is
made using `SHA1` instead of `bcrypt`, and the hash supplied to `capi-shim`
for authentication will not be valid.

Therefore, the config flag `use_bcrypt` is set to `false` by default into the
UFDS config file.

Once there isn't any legacy application trying to authenticate users using
`capi-shim`, switching to use `bcrypt` would be as complex as setting the value
for the aforementioned `use_bcrypt` config flag to `true`.

Of course, if there aren't applications trying to auth users through `capi-shim`
the CAPI shim application should be disabled (`svcadm disable ufds-capi`).

# Working with capi limits

### Find a given user UUID by user login (let's go with mine, remember to restore!):

    sdc-ldap search '(&(objectclass=sdcperson)(login=<login>))'

#### Example:

    sdc-ldap search '(&(objectclass=sdcperson)(login=pedro))'

    dn: uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc
    cn: Pedro P. Candel
    company: Joyent Inc.
    email: example@example.com
    givenname: Pedro
    login: pedro
    objectclass: sdcperson
    phone: +1234567890
    pwdchangedtime: 1366098276550
    sn: P. Candel
    uuid: dfc6bef2-7f4a-4c24-bb74-949ff395cd72
    approved_for_provisioning: true
    created_at: 1366382409973
    updated_at: 1366382409973

### Find user limits for all DCs using USER UUID

    sdc-ldap search -b 'uuid=<UUID>, ou=users, o=smartdc' objectclass=capilimit

#### Example:

    sdc-ldap search -b 'uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc' objectclass=capilimit


### Add a limit for a given user on a given DC

    dn: dclimit=<DC_NAME>, uuid=<UUID>, ou=users, o=smartdc
    datacenter: <DC_NAME>
    objectclass: capilimit
    <IMAGE_NAME>: <VALUE>
    <IMAGE_NAME>: <VALUE>
    <IMAGE_NAME>: <VALUE>


Save the following on a file, say `dfc6bef2-7f4a-4c24-bb74-949ff395cd72.ldif`:

    dn: dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc
    datacenter: coal
    objectclass: capilimit
    smartos: 5

Make sure your ldif file has no spaces at the beginning of these lines, neither right after the values.
Then, add with:

    sdc-ldap add -f dfc6bef2-7f4a-4c24-bb74-949ff395cd72.ldif

You should see something like:

    adding new entry "dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc"


### Update existing user limit for a given DC


    dn: dclimit=<DC_NAME>, uuid=<UUID>, ou=users, o=smartdc
    changetype: modify
    replace: <IMAGE_NAME>|add: <IMAGE_NAME>|delete: <IMAGE_NAME>
    <IMAGE_NAME>: <VALUE>


### Case one: Modifying existing limit for a given dataset/image

Let's say we want to change `smartos: 5` to something higher, say 8. We need the following file:

    dn: dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc
    changetype: modify
    replace: smartos
    smartos: 8

Of course, we've saved the file with the same name than before, so we can update by running:

    sdc-ldap modify -f dfc6bef2-7f4a-4c24-bb74-949ff395cd72.ldif

And you will see the following output now:

    modifying entry "dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc"


### Case two: Adding a new property (a limit for another image/dataset):

Now, we'll add a limit for an image not already limited for the user:

    dn: dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc
    changetype: modify
    add: multiarch
    multiarch: 3

Again, we saved as the same file name, we'll run the same command:

    sdc-ldap modify -f dfc6bef2-7f4a-4c24-bb74-949ff395cd72.ldif

And we'll see the same output:

    modifying entry "dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc"

### Case three: We want to remove limits completely for a given image/dataset:

On this case, we're gonna remove the limit for `multiarch`:

    dn: dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc
    changetype: modify
    delete: multiarch

Note the absence of the `<IMAGE_NAME>: <VALUE>` line on this case.

Once again!, we saved as the same file name, we'll run the same command:

    sdc-ldap modify -f dfc6bef2-7f4a-4c24-bb74-949ff395cd72.ldif

And we'll see the same output:

    modifying entry "dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc"


### Remove a limit completely:

If you want to remove the whole capilimit object from UFDS:

    sdc-ldap delete "dclimit=coal, uuid=dfc6bef2-7f4a-4c24-bb74-949ff395cd72, ou=users, o=smartdc"

And, again: please, please, please, make sure you don't have EOL neither EOF whitespaces.

# Development

## Manually encrypting passwords using SHA1

In case you need to manually encrypt a password to compare with the automatically encrypted
values for development purposes, the procedure to follow would be:

1. Login into the `ufds` zone and get the `salt` value for the desired user UUID using
   `ldapjs-search`:

    [root@headnode (coal) ~]# sdc-login ufds
    [Connected to zone 'ad83eb90-a9e0-4ba5-ab90-3fef6047ca4a' pts/2]
    Last login: Mon Aug  5 11:37:58 on pts/2
    [root@ad83eb90-a9e0-4ba5-ab90-3fef6047ca4a (coal:ufds0) ~]# ldapjs-search -i -u ldaps://127.0.0.1 -D cn=root -w secret -c 1.3.6.1.4.1.38678.1 -b o=smartdc "(uuid=930896af-bf8c-48d4-885c-6573a94b1853)"|json _salt
    396824f1cce568df18e09482eb60ae3e3d5fcf96

2. Use `node` from the `ufds` zone to encrypt the password with the desired value:


    [root@ad83eb90-a9e0-4ba5-ab90-3fef6047ca4a (coal:ufds0) ~]# node
    > var crypto = require('crypto');
    undefined
    > var salt = '396824f1cce568df18e09482eb60ae3e3d5fcf96'
    undefined
    > var password = 'testing123'
    undefined
    > var hash = crypto.createHash('sha1');
    undefined
    > hash.update('--');
    {}
    > hash.update(salt);
    {}
    > hash.update('--');
    {}
    > hash.update(password);
    {}
    > hash.update('--');
    {}
    > hash.digest('hex');
    'bf5c7ad26e7a7a7d8459075a19e8930596281410'



# LogLevels

The logLevel sets the verbosity of debug logging in the SMF log file.  By
default, UFDS logs at `info` level, which means you'll get start/stop and
error messages (in addition to request logging).  If you are encountering a
problem with UFDS, you'll almost certainly want the level to be set to
`debug` or `trace`.  See [Troubleshooting](#Troubleshooting) below.

# Troubleshooting

If you are seeing errors/bugs with the UFDS sdc-ldap CLI, or with the
applications talking to the UFDS server, you can turn on debug logging
for UFDS as explained below.

First, you should check the logs files. You can get a list of all the log
files related to the UFDS server, CAPI shim, HAproxy and, eventually, the
UFDS Replicator by running:

    $ `svcs -L *ufds*`

Reviewing those files and looking for any indication of errors should give
you an idea of what it's going wrong.  Note that UFDS logs some amount
of request information by default, and logs `WARN` level entries anytime there
is an error sent to the client (including if the error is user initiated). If
you cannot determine the problem of the error from the default logs, turn on
debug logging.

## Debug Logging in SMF

Log messages can be traced using `bunyan -p ufds` as explained into
[Bunyan DTrace Examples](https://github.com/trentm/node-bunyan#dtrace-examples)
