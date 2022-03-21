#!/bin/bash -e

# set -x (bash debug) if log level is trace
# https://github.com/osixia/docker-light-baseimage/blob/stable/image/tool/log-helper
log-helper level eq trace && set -x

FIRST_START_DONE="${CONTAINER_STATE_DIR}/krb5kdc-first-start-done"

# CONTAINER_SERVICE_DIR and CONTAINER_STATE_DIR variables are set by
# the baseimage run tool more info : https://github.com/osixia/docker-light-baseimage

# container first start
if [ ! -e "$FIRST_START_DONE" ]; then

  KDC_PASSWORD=password
  KADMIN_PASSWORD=password
  KRB_MASTER_PASSWORD=admin
  KRB_REALM=EXAMPLE.ORG

  function get_ldap_base_dn() {
    # if LDAP_BASE_DN is empty set value from LDAP_DOMAIN
    if [ -z "$LDAP_BASE_DN" ]; then
      IFS='.' read -ra LDAP_BASE_DN_TABLE <<< "$LDAP_DOMAIN"
      for i in "${LDAP_BASE_DN_TABLE[@]}"; do
        EXT="dc=$i,"
        LDAP_BASE_DN=$LDAP_BASE_DN$EXT
      done

      LDAP_BASE_DN=${LDAP_BASE_DN::-1}
    fi
    # Check that LDAP_BASE_DN and LDAP_DOMAIN are in sync
    domain_from_base_dn=$(echo $LDAP_BASE_DN | tr ',' '\n' | sed -e 's/^.*=//' | tr '\n' '.' | sed -e 's/\.$//')
    if `echo "$domain_from_base_dn" | egrep -q ".*$LDAP_DOMAIN\$" || echo $LDAP_DOMAIN | egrep -q ".*$domain_from_base_dn\$"`; then
      : # pass
    else
      log-helper error "Error: domain $domain_from_base_dn derived from LDAP_BASE_DN $LDAP_BASE_DN does not match LDAP_DOMAIN $LDAP_DOMAIN"
      exit 1
    fi
  }

  get_ldap_base_dn

  # Change password for Kerberos entities
  ldappasswd -x -D cn=admin,${LDAP_BASE_DN} -w ${LDAP_ADMIN_PASSWORD} -s ${KDC_PASSWORD} -S uid=kdc-service,${LDAP_BASE_DN}
  ldappasswd -x -D cn=admin,${LDAP_BASE_DN} -w ${LDAP_ADMIN_PASSWORD} -s ${KADMIN_PASSWORD} -S uid=kadmin-service,${LDAP_BASE_DN}

  # Cache credentials used by KDC when binding to LDAP server (see /etc/krb5kdc/kdc.conf)
  coproc kdb5_ldap_util stashsrvpw -f /etc/krb5kdc/ldap.stash uid=kdc-service,${LDAP_BASE_DN}
  echo ${KDC_PASSWORD} >&${COPROC[1]}
  echo ${KDC_PASSWORD} >&${COPROC[1]}
  wait

  coproc kdb5_ldap_util stashsrvpw -f /etc/krb5kdc/ldap.stash uid=kadmin-service,${LDAP_BASE_DN}
  echo ${KADMIN_PASSWORD} >&${COPROC[1]}
  echo ${KADMIN_PASSWORD} >&${COPROC[1]}
  wait

  # Create KDC database (-s flag will stash password at /etc/krb5kdc/.k5.*, alternatively run `kdb5_util stash`)
  coproc kdb5_ldap_util -D cn=admin,${LDAP_BASE_DN} -w ${LDAP_ADMIN_PASSWORD} -H ldapi:// create \
      -subtrees ou=People,${LDAP_BASE_DN}:ou=services,${LDAP_BASE_DN} -sscope SUB -r ${KRB_REALM} -s
  echo ${KRB_MASTER_PASSWORD} >&${COPROC[1]}
  echo ${KRB_MASTER_PASSWORD} >&${COPROC[1]}
  wait

  # Add principles for KeyCloak and generate keytab
  kadmin.local -q "addprinc -randkey -x containerdn=ou=services,"${LDAP_BASE_DN}" HTTP/keycloak.127.0.0.1.nip.io@"${KRB_REALM}
  rm -f /etc/keytabs/keycloak.keytab
  kadmin.local -q "ktadd -k /etc/keytabs/keycloak.keytab HTTP/keycloak.127.0.0.1.nip.io@"${KRB_REALM}

  # Add entries for exiting LDAP users
  kadmin.local -q "addprinc -pw password -x dn=uid=alice,ou=People,"${LDAP_BASE_DN}" alice"
  kadmin.local -q "addprinc -pw password -x dn=uid=bob,ou=People,"${LDAP_BASE_DN}" bob"

  #
  # setup done :)
  #
  log-helper info "First start is done..."
  touch $FIRST_START_DONE
fi


start-stop-daemon --start --pidfile /var/run/krb5kdc.pid --startas /usr/sbin/krb5kdc --name krb5kdc -- -P /var/run/krb5kdc.pid
tail --pid=`cat /var/run/krb5kdc.pid` -f /dev/null
