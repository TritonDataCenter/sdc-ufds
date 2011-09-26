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

# Development

## Riak

You need a 1.0.x version of Riak.  As of this writing, they are still in release
candidate(s) for 1.0, but you can grab one here:
<http://downloads.basho.com/riak/riak-1.0.0rc1>.

Once you have that, you need to be on the leveldb backend, so crack open
`riak-1.0.0rc1/etc/app.config` and under the section `{riak_kv`, change the
key `storage_backend` to `riak_kv_eleveldb_backend` (it will probably be set
to bitcask).  Once you have that, you also need to increase your ulimits:
`ulimit -n 2048`, and I just run from a local shell: `./bin/riak start`. If you
want to clean out/reset your data:
`./bin/riak stop && rm -fr data/leveldb/* && ./bin/riak start`

Note that UFDS heavily leverages riak secondary indexing, which isn't really
documented yet, save here: <https://gist.github.com/d66f8298802e4ae28e95>.

## UFDS

Next you need to start UFDS, which is the LDAP interface over riak.  Config
for this is stored in `./cfg/config.json`, but assuming you're running localhost
riak, you should be good to go with: `node main.js -f cfg/config.json -d 2`;
note the `-d 2` is optional, but will spew diagnostic logs for you, which is
helpful if you're developing.

### Bootstrapping

Once you have riak+ufds running, you need to 'bootstrap' the LDAP tree. There's
a small LDIF file that has what you need, so just run this:

    `ldapadd -H ldap://localhost:1389 -x -D cn=root -w secret -f data/bootstrap.ldif`

## CAPI

To maintain backwards compatibility, there is a restify app that "approximates"
the old CAPI interface. It assumes that UFDS is running on the same host, so to
fire it up, just run `node capi.js -p 8080 -d 2`.

To make curl'ing the CAPI thing easier, I have a small bash function:

    function capi() {
        /usr/bin/curl -is -H 'Accept: application/json' -H 'content-type: application/xml' -u admin:tot@ls3crit --url http://localhost:8080$@ ;
        echo "";
    }

### Adding/Updating/Listing/Deleteing Customers

Edit the file to your heart's content and POST to add:

`capi /customers -d @/Users/mark/work/ufds/data/capi_customer.xml`

Update with:

`capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d -d @/Users/mark/work/ufds/data/update_customer.xml -X PUT`

Get with:

`capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d`

List/Search with:

`capi /customers`
`capi /customers?email_address=%40joyent.com`

Delete with:

`capi /customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d -X DELETE`

### SSH keys

Add (can't use fn(), as content-type is different):
`/usr/bin/curl -is http://localhost:8080/customers/03afb9ac-925c-4e39-9ec2-ddbb2df9ef7d/keys --data-urlencode key@/Users/mark/.ssh/id_rsa.pub -d name=id_rsa`

List:

`capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys`

Rename:

`capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys/7bc05cd69e110c76044b03c911f2727f?name=foo -X PUT`

Delete:

`capi /customers/9c664a75-b638-4bc6-9213-9cda22f8f2d9/keys/7bc05cd69e110c76044b03c911f2727f -X DELETE`

## Raw LDAP

Preferably though, you're going to use LDAP directly, as it's more powerful than
the CAPI shim.  Here's some stuff to get you going.

`alias lsearch='ldapsearch -H ldap://localhost:1389 -x -LLL -D cn=root -w secret -b o=smartdc'`
`alias ladd='ldapadd -H ldap://localhost:1389 -x -D cn=root -w secret -f'`
`alias ldelete='ldapdelete -H ldap://localhost:1389 -x -D cn=root -w secret'`
`alias lmodify='ldapmodify -H ldap://localhost:1389 -x -D cn=root -w secret -f'`

### Searches

Not everything here is really suitable for production, as the `objectclass=`
searches are not hitting indexes.  I marked these for note.

Everything (N/A):

`lsearch objectclass=*`

Customers (N/A):

`lsearch -b ou=customers,o=smartdc objectclass=sdcperson`

Customer by login:

`lsearch -b ou=customers,o=smartdc login=mark`

Keys for a customer:

`lsearch -b uuid=9c664a75-b638-4bc6-9213-9cda22f8f2d9,ou=customers,o=smartdc fingerprint=*`

Operators (N/A):

`lsearch -b ou=operators,o=smartdc objectclass=sdcperson`


