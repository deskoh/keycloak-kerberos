# KeyCloak Kerberos Demo

## QuickStart

### Kerberos Setup

```sh
# Start services using Docker Compose
docker-compose up

# Verify valid keytab file generated
docker exec keycloak-openldap kinit HTTP/keycloak.127.0.0.1.nip.io@EXAMPLE.ORG -k -t /etc/keytabs/keycloak.keytab
# List and destroy Kerberos ticket
docker exec keycloak-openldap klist
docker exec keycloak-openldap kdestroy
```

### Accessing Keycloak

* URL: http://keycloak.127.0.0.1.nip.io:8080

* Username: `admin`

* Password: `password`

* OIDC Endpoint: `http://localhost:8080/auth/realms/{realm}/.well-known/openid-configuration`

* Authorization Endpoint: `http://localhost:8080/auth/realms/{realm}/protocol/openid-connect/auth`

Create a KeyCloak Realm `dev` by importing `/keycloak/realm-dev-export.json`

### Kerberos Login Test

> Credentials: `alice@EXAMPLE.ORG` / `password`, `bob@EXAMPLE.ORG` / `password`

1. `js-console` [login](http://js-console.127.0.0.1.nip.io:8000/) 

2. `OIDC Debugger` [login](https://oidcdebugger.com/)
   > Open `Send Request` using InPrivate / Cognito Window

   * Authorization Endpoint: `http://keycloak.127.0.0.1.nip.io:8080/   auth/realms/dev/protocol/openid-connect/auth`

   * Redirect URL: `https://oidcdebugger.com/debug`

   * Client ID: `oidc-debugger`


### Cleanup

```sh
# Cleanup
docker-compose rm -f
docker volume rm keycloak_vol-mariadb  keycloak_vol-openldap-ldap keycloak_vol-openldap-slapd
```

## Creating new Users

Creating users is now a two-step process:

1. Create new user with ldapadd (if KeyCloak Kerberos configured to be backed by an LDAP server).

1. Create new KDC entry using `addprinc` (for Kerberos Authentication) and link it to the DN. E.g.:

   ```sh
   kadmin.local
   kadmin.local: addprinc -pw password -x dn=uid=charlie,ou=People,   dc=example,dc=org charlie
   ```

## Kerberos Setup Verification / Debugging

> Run the following commands in `keycloak-openldap` container: `docker exec -it keycloak-openldap bash`
> Default password for `ldapsearch` command is provided using `-w` flag. Use `-W` for interactive password prompt.

```sh
# Verify LDAP credentials
ldapwhoami -x -D "cn=admin,dc=example,dc=org" -w admin
ldapwhoami -x -D "uid=alice,ou=People,dc=example,dc=org" -w password

# Verify krbContainer container exists (numEntries: 1)
ldapsearch -L -x -D cn=admin,dc=example,dc=org -b dc=example,dc=org -w admin cn=krbContainer

# Verify ACL for kdc-service and kadmin-service (numEntries: 12)
ldapsearch -L -x -D uid=kdc-service,dc=example,dc=org -b cn=krbContainer,dc=example,dc=org -w password
ldapsearch -L -x -D uid=kadmin-service,dc=example,dc=org -b cn=krbContainer,dc=example,dc=org -w password

# Verify Kerberos services are started
service krb5-kdc status
service krb5-admin-server status

# Validate Kerberos token can be obtained using keytab file
kinit HTTP/keycloak.127.0.0.1.nip.io@EXAMPLE.ORG -k -t /etc/keytabs/keycloak.keytab
klist
kdestroy

# Login using SPNEGO
# 302 returned with access code: # http://js-console.127.0.0.1.nip.io:8000/?session_state=...&code=...
# To use existing ticket, use curl -I --negotiate -u : http://....
curl -I --negotiate -u alice@EXAMPLE.ORG:password "http://keycloak.127.0.0.1.nip.io:8080/auth/realms/dev/protocol/openid-connect/auth?client_id=js-console&redirect_uri=http%3A%2F%2Fjs-console.127.0.0.1.nip.io%3A8000%2F&response_type=code&scope=openid"
```

## Windows Client Setup

Create a principal for Windows Client

```sh
# Remember the password for the principal (e.g. `password`)
# IMPORTANT: Value of %COMPUTERNAME% has to be lower case
docker exec -it keycloak-openldap kadmin.local -q "addprinc host/%COMPUTERNAME%.example.org"

# Run the following commands as Administrator

# Set domain (computername and workgroup of computer will change)
ksetup /setdomain EXAMPLE.ORG

# Update KDC for domain (where 172.30.160.1 is the IP of OpenLDAP)
# To verify windows client can reach the OpenLDAP via IP, use `openssl s_client -connect localhost:636`
ksetup /AddKdc EXAMPLE.ORG 172.30.160.1
# ksetup /DelKdc EXAMPLE.ORG X.X.X.X

# Set the machine password to be the same as the principal created above (`password` in this example)
ksetup /setmachpassword password

# Optional: ksetup /AddRealmFlags EXAMPLE.ORG delegate

# Map domain user to local user
ksetup /mapuser alice@EXAMPLE.ORG %USERNAME%
```

Verify Windows Client can authenticate using Kerberos:

```sh
# For logs see `/var/log/krb5kdc.log` in OpenLDAP container (logging is configured in krb5.conf file)
runas /user:alice@EXAMPLE.ORG cmd
```

Common Errors:

1. `1787: The security database on the server does not have a computer account for this workstation trust relationship.`

1. Principal for Windows Client not added: The principal name has to be lowercase.

## SSL Setup

```sh
# Generate CA key and cert
openssl req -x509 -nodes -newkey rsa:2048 -keyout rootCA.key \
  -days 3650 -out rootCA.crt \
  -subj "/C=SG/OU=www.org/O=MyOrg, Inc./CN=My Org Root CA"

# Generate CSR for keycloak
openssl req -newkey rsa:2048 -nodes -keyout keycloak.key \
  -new -out keycloak.csr \
  -subj "/C=SG/L=Singapore/O=MyOrg, Inc./CN=keycloak" \
  -addext "subjectAltName=DNS:localhost,DNS:keycloak.127.0.0.1.nip.io" \
  -addext "keyUsage=digitalSignature,keyEncipherment"

# Generate CA signed cert for keycloak
openssl x509 -in keycloak.csr \
  -CA rootCA.crt -CAkey rootCA.key -CAcreateserial \
  -req -days 3650 -out keycloak.crt \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:keycloak,DNS:keycloak.127.0.0.1.nip.io")

# Generate CSR for openldap
openssl req -newkey rsa:2048 -nodes -keyout ldap.key \
  -new -out ldap.csr \
  -subj "/C=SG/L=Singapore/O=MyOrg, Inc./CN=openldap" \
  -addext "subjectAltName=DNS:localhost,DNS:openldap,DNS:openldap.127.0.0.1.nip.io" \
  -addext "keyUsage=digitalSignature,keyEncipherment"

# Generate CA signed cert for openldap (using previous CA serial file rootCA.srl)
openssl x509 -in ldap.csr \
  -CA rootCA.crt -CAkey rootCA.key -CAserial rootCA.srl \
  -req -days 3650 -out ldap.crt \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:openldap,DNS:openldap.127.0.0.1.nip.io")

# Verify certs
openssl verify -verbose -CAfile rootCA.crt keycloak.crt
openssl verify -verbose -CAfile rootCA.crt ldap.crt
```

SSL / TLS debugging

```sh
openssl s_client -connect localhost:636
openssl s_client -connect localhost:8443
```

## References / Resources

### Kerberos

* [MIT Kerberos Documentation](https://web.mit.edu/kerberos/krb5-latest/doc/index.html)
  * [System Administrator's Guide](https://web.mit.edu/kerberos/krb5-latest/doc/admin)
  * [Configuration Files](https://web.mit.edu/kerberos/krb5-latest/doc/admin/conf_files/index.html)
  * [Configuring Kerberos with OpenLDAP back-end](https://web.mit.edu/kerberos/krb5-1.18/doc/admin/conf_ldap.html)
* [Ubuntu Docs: Kerberos and LDAP](https://ubuntu.com/server/docs/service-kerberos-with-openldap-backend)
* [Kerberos Environment Setup](https://docs.spring.io/spring-security-kerberos/docs/current/reference/html/setup-kerberos-environments.html)
* [Configuring a Master KDC on an OpenLDAP Directory Server](https://docs.oracle.com/cd/E53394_01/html/E54787/st-openldap.html)
* [All About Kerberos “The Three Headed Dog” with respect to IIS and Sql](https://techcommunity.microsoft.com/t5/iis-support-blog/all-about-kerberos-the-three-headed-dog-with-respect-to-iis-and/ba-p/324641)
* [Kerberos and Windows Security: Kerberos v5 Protocol](https://medium.com/@robert.broeckelmann/kerberos-and-windows-security-kerberos-v5-protocol-b9c804e06479)
* [Performing Kerberoasting without SPNs](https://swarm.ptsecurity.com/kerberoasting-without-spns/)
* [Kerberos Wireshark Captures](https://medium.com/@robert.broeckelmann/kerberos-wireshark-captures-a-windows-login-example-151fabf3375a)
* [Using Kerberos in NAT and DHCP Environments](https://www.itprotoday.com/windows-78/using-kerberos-nat-and-dhcp-environments)
* [Keycloak Kerberos](https://www.keycloak.org/docs/latest/server_admin/#_kerberos)
