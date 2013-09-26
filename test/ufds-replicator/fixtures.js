/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the Boilerplate API endpoints */


var USER = {
	dn: 'uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
	object: {
		login: 'unpermixed',
		uuid: 'a820621a-5007-4a2a-9636-edde809106de',
		userpassword: 'FL8xhOFL8xhO',
		email: 'postdisseizor@superexist.com',
		cn: 'Judophobism',
		sn: 'popgun',
		company: 'butterflylike',
		address: 'liltingly, Inc.',
		address: '6165 pyrophyllite Street',
		city: 'benzoylation concoctive',
		state: 'SP',
		postalCode: '4967',
		country: 'BAT',
		phone: '+1 891 657 5818',
		objectclass: 'sdcPerson'
	}
};


var KEY = {
	dn: 'fingerprint=db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9, uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
	object: {
		name: 'flashlight',
		fingerprint: 'db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9',
		openssh: 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEA1UeAFVU5WaJJwe+rPjN7MbostuTX5P2NOn4c07ymxnFEHSH4LJZkVrMdVQRHf3uHLaTyIpCSZfm5onx0s2DoRpLreH0GYxRNNhmsfGcav0teeC6jSzHjJnn+pLnCDVvyunSFs5/AJGU27KPU4RRF7vNaccPUdB+q4nGJ1H1/+YE= tetartoconid@valvulotomy',
		objectclass: 'sdcKey'
	}
};


module.exports = {
	user: USER,
	key: KEY
};