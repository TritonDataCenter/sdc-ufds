NAME=ufds

ifeq ($(VERSION), "")
	@echo "Use gmake"
endif

SRC := $(shell pwd)
TAR = tar
UNAME := $(shell uname)
ifeq ($(UNAME), SunOS)
	TAR = gtar
endif

HAVE_GJSLINT := $(shell which gjslint >/dev/null && echo yes || echo no)
NPM := npm_config_tar=$(TAR) npm

DOCPKGDIR = ./docs/pkg
RESTDOWN = ./node_modules/.restdown/bin/restdown \
	-b ./node_modules/.restdown/brand/ohthejoy \
	-m ${DOCPKGDIR}


ifeq ($(TIMESTAMP),)
	TIMESTAMP=$(shell date -u "+%Y%m%dT%H%M%SZ")
endif

UFDS_PUBLISH_VERSION := $(shell git symbolic-ref HEAD | \
	awk -F / '{print $$3}')-$(TIMESTAMP)-g$(shell \
	git describe --all --long | awk -F '-g' '{print $$NF}')

RELEASE_TARBALL=ufds-pkg-$(UFDS_PUBLISH_VERSION).tar.bz2

# make pkg release publish is the convention set forth by CA.
# we use pkg to run npm install, release is a no-op and publish gets run on the
# build machine
.PHONY:  dep lint test doc clean all pkg release publish

all:: dep pkg doc

node_modules/.npm.installed:
	$(NPM) install --dev --node-version=0.4.12
	if [[ ! -d node_modules/.restdown ]]; then \
		git clone git://github.com/trentm/restdown.git node_modules/.restdown; \
	else \
		(cd node_modules/.restdown && git fetch origin); \
	fi
	@(cd ./node_modules/.restdown && git checkout $(RESTDOWN_VERSION))
	@touch ./node_modules/.npm.installed

dep:	./node_modules/.npm.installed

gjslint:
	gjslint --nojsdoc -r lib -r tst

ifeq ($(HAVE_GJSLINT), yes)
lint: gjslint
else
lint:
	@echo "* * *"
	@echo "* Warning: Cannot lint with gjslint. Install it from:"
	@echo "*    http://code.google.com/closure/utilities/docs/linter_howto.html"
	@echo "* * *"
endif


doc: dep
	@rm -rf ${DOCPKGDIR}/readme.html
	@mkdir -p ${DOCPKGDIR}
	${RESTDOWN} -m ${DOCPKGDIR} ./README
	@rm README.json
	@mv README.html ${DOCPKGDIR}/readme.html
	(cd ${DOCPKGDIR} && $(TAR) -czf ${SRC}/${NAME}-docs-`git log -1 --pretty='format:%h'`.tar.gz *)


test: dep lint
	$(NPM) test

pkg: dep

release: $(RELEASE_TARBALL)

$(RELEASE_TARBALL):
	$(TAR) -cjf $(RELEASE_TARBALL) \
	capi \
	capi.js \
	lib \
	main.js \
	node_modules \
	package.json \
	schema

publish:
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/ufds
	cp $(RELEASE_TARBALL) $(BITS_DIR)/ufds/$(RELEASE_TARBALL)

clean:
	@rm -fr ${DOCPKGDIR}/*.html ${DOCPKGDIR}/pkg/css \
		node_modules *.log *.tar.gz *.tar.bz2
