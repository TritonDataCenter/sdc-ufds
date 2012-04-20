export PATH=$PWD/build/node/bin:$PWD/node_modules/.bin:$PATH

alias ufds_laptop='node main.js -f ./etc/ufds.laptop.config.json -d 2 2>&1 | bunyan'

export LURL=ldap://localhost:1389
export LCREDS="-D cn=root -w secret"
alias ladd_laptop='ldapadd -x -H $LURL $LCREDS'
alias lsearch_laptop='ldapsearch -x -LLL -H $LURL $LCREDS'
alias ldel_laptop='ldapdelete -x -H $LURL $LCREDS'
alias lmod_laptop='ldapmodify -x -H $LURL $LCREDS'
