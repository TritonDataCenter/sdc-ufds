#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

export PATH=$PWD/build/node/bin:$PWD/node_modules/.bin:/opt/local/bin:$PATH

alias ufds_laptop='node main.js -s -f ./etc/config.coal.json -d 1 2>&1 | bunyan'

export LURL=ldap://127.0.0.1:1389
export LCREDS="-D cn=root -w secret"
alias ladd_laptop='ldapadd -x -H $LURL $LCREDS'
alias lsearch_laptop='ldapsearch -x -LLL -H $LURL $LCREDS'
alias ldel_laptop='ldapdelete -x -H $LURL $LCREDS'
alias lmod_laptop='ldapmodify -x -H $LURL $LCREDS'
