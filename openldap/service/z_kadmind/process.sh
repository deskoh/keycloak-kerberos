#!/bin/bash -e

while [ ! -f /etc/krb5kdc/ldap.stash ]; do sleep 1; done
start-stop-daemon --start --pidfile /var/run/kadmind.pid --startas /usr/sbin/kadmind --name kadmind -- -P /var/run/kadmind.pid
tail --pid=`cat /var/run/kadmind.pid` -f /dev/null
