# Overview

UFDS is the "unified foundational directory service" built for SDC over
[ldapjs](http://ldapjs.org) and [Riak](https://github.com/mcavage/node-ldapjs-riak).
In short, it's the new CAPI.

# DIT

## Hierarchy

The directory tree is laid out as follows:

    o=smartdc
      +-ou=customers
      |  +-login=:login
      |  | +-key=:name
      |  | +-ou=users
      |  | | +-login=:login
      |  | | | +-key=:name
      |  | +-ou=groups
      |  | | +-cn=:name
      +-ou=operators
      |  +-login=:login
      |  | +-key=:name

## Schema

The following objectclass definitions make up each of the entities currently in
the tree:

### Users

#### sdcPerson

Represents a "traditional" customer in CAPI, and is the base objectclass type
for all the other entries that are "people/users".

    {
      required: [login, uuid, userPassword, email],
      optional: [company, cn, sn, address, city, state, postalCode, country, phone]
    }

UniqueIndexes:

* login
* uuid
* email

#### sdcCustomer

Represents a customer account that we allow resource ownership with.  The users
_directly_ under `ou=customers` will use this objectclass type. Nothing but a
structural extension of `sdcPerson`.

#### sdcOperator

Represents an "operator" in the SmartDataCenter. The users under `ou=operators`
will leverage this objectclass. This objectclass is just a structural extension
of `sdcPerson` and the objectclass extension is used to replace the CAPI
`role` column.

#### sdcSubUser

Represents a "sub user". Sub users are the user management feature present in
SDC, and a subuser is directly "owned" by a `sdcPerson`. If you haven't guessed,
it's an extension of an `sdcPerson`.  These entries sit underneath an account
in the `ou=customers` tree.

### Keys

Keys are containers for an ssh key, and are always placed directly underneath
the "owning" user.  The objectclass still has a `owner` field (contains the
uuid), solely so that you can easily find all keys belonging to a given user.

    {
      required: [name, owner, fingerprint, sshKey, pkcs8],
      optional: []
    }

Indexes:

* owner
* fingerprint

### Groups

#### sdcGroup

Simply contains a list of DNs.  Can be placed pretty much anywhere in the tree.

    {
      optional: [member]
    }

#### sdcPersonGroup

Extension of `sdcGroup`.  Contains a list of sdcPeron DNs only.  Code on top of
the system can use this in a "context sensitive" way depending on where the
group is in the tree.
