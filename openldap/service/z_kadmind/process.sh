#!/bin/bash -e

start-stop-daemon --start --pidfile /var/run/kadmind.pid --startas /usr/sbin/kadmind --name kadmind -- -P /var/run/kadmind.pid
tail --pid=`cat /var/run/kadmind.pid` -f /dev/null
