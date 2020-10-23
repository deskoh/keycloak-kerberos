(function () {
    let kc;
    Keycloak.prototype.checkSsoSilently = function () {
        kc = this;
        if (!kc.silentCheckSsoRedirectUri) {
            console.warn("[KEYCLOAK] 3rd party cookies aren't supported by this browser. Silent refresh not available");
            return;
        }
        const ifrm = document.createElement('iframe');
        const src = kc.createLoginUrl({ prompt: 'none', redirectUri: kc.silentCheckSsoRedirectUri });
        ifrm.setAttribute('src', src);
        ifrm.setAttribute('title', 'keycloak-silent-refresh');
        ifrm.style.display = 'none';
        document.body.appendChild(ifrm);

        const messageCallback = function (event) {
            if (event.origin !== window.location.origin || ifrm.contentWindow !== event.source) {
                return;
            }
            parseCallback(event.data);

            document.body.removeChild(ifrm);
            window.removeEventListener('message', messageCallback);
        };

        window.addEventListener('message', messageCallback);
    };

    const parseCallback = (url) => {
        const oauth = parseCallbackUrl(url);
        const error = !oauth || oauth.error;
        if (error) {
            console.warn('[KEYCLOAK] Failed to refresh token');
            if (error === 'login_required') {
                kc.clearToken();
            }
            kc.onAuthRefreshError && kc.onAuthRefreshError();
            return;
        }

        // Extract nounce from localstorage
        const key = 'kc-callback-' + oauth.state;
        let value = localStorage.getItem(key);
        if (value) {
            localStorage.removeItem(key);
            oauthState = JSON.parse(value);
            oauth.valid = true;
            oauth.redirectUri = oauthState.redirectUri;
            oauth.storedNonce = oauthState.nonce;
            oauth.prompt = oauthState.prompt;
            oauth.pkceCodeVerifier = oauthState.pkceCodeVerifier;
        }

        if ((kc.flow !== 'implicit') && oauth.code) {
            var params = 'code=' + oauth.code + '&grant_type=authorization_code';
            var url = kc.endpoints.token();

            var req = new XMLHttpRequest();
            req.open('POST', url, true);
            req.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

            params += '&client_id=' + encodeURIComponent(kc.clientId);
            params += '&redirect_uri=' + oauth.redirectUri;

            if (oauth.pkceCodeVerifier) {
                params += '&code_verifier=' + oauth.pkceCodeVerifier;
            }
            req.withCredentials = true;

            req.onreadystatechange = function () {
                if (req.readyState == 4) {
                    if (req.status == 200) {
                        var tokenResponse = JSON.parse(req.responseText);
                        authSuccess(tokenResponse['access_token'], tokenResponse['refresh_token'], tokenResponse['id_token'], kc.flow === 'standard');
                        // TODO: scheduleCheckIframe();
                    } else {
                        kc.onAuthError && kc.onAuthError();
                    }
                }
            };

            req.send(params);
        }

        function authSuccess(accessToken, refreshToken, idToken) {

            const timeLocal = new Date().getTime();

            kc.idToken = idToken;
            kc.idTokenParsed = decodeToken(idToken);

            kc.token = accessToken;
            kc.refreshToken = refreshToken
            kc.tokenParsed = decodeToken(accessToken);
            kc.sessionId = kc.tokenParsed.session_state;
            kc.authenticated = true;
            kc.subject = kc.tokenParsed.sub;
            kc.realmAccess = kc.tokenParsed.realm_access;
            kc.resourceAccess = kc.tokenParsed.resource_access;

            if (timeLocal) {
                kc.timeSkew = Math.floor(timeLocal / 1000) - kc.tokenParsed.iat;
            }

            if (kc.timeSkew != null) {
                if (kc.onTokenExpired) {
                    var expiresIn = (kc.tokenParsed['exp'] - (new Date().getTime() / 1000) + kc.timeSkew) * 1000;
                    console.info('[KEYCLOAK] Token expires in ' + Math.round(expiresIn / 1000) + ' s');
                    if (expiresIn <= 0) {
                        kc.onTokenExpired();
                    } else {
                        kc.tokenTimeoutHandle = setTimeout(kc.onTokenExpired, expiresIn);
                    }
                }
            }

            // assume useNonce
            if ((kc.tokenParsed && kc.tokenParsed.nonce !== oauth.storedNonce) ||
                (kc.idTokenParsed && kc.idTokenParsed.nonce !== oauth.storedNonce)) {
                console.info('[KEYCLOAK] Invalid nonce, clearing token');
                kc.clearToken();
                kc.onAuthRefreshError && kc.onAuthRefreshError();
            }
            console.info('[KEYCLOAK] Token refreshed');
            kc.onAuthRefreshSuccess && kc.onAuthRefreshSuccess();
        }

        return oauth;
    }

    const parseCallbackUrl = (url) => {
        // auth code supported params
        const supportedParams = ['state', 'session_state', 'code'];
        supportedParams.push('error');
        supportedParams.push('error_description');
        supportedParams.push('error_uri');

        const fragmentIndex = url.indexOf('#');
        if (kc.responseMode === 'fragment' && fragmentIndex !== -1) {
            newUrl = url.substring(0, fragmentIndex);
            const parsed = parseCallbackParams(url.substring(fragmentIndex + 1), supportedParams);
            if (parsed.oauthParams && kc.flow !== 'implicit') {
                if ((parsed.oauthParams.code || parsed.oauthParams.error) && parsed.oauthParams.state) {
                    return parsed.oauthParams;
                }
            }
        }
    }

    const parseCallbackParams = (paramsString, supportedParams) => {
        var result = {
            oauthParams: {}
        }

        paramsString.split('&').reduce((result, item) => {
            const tokens = item.split('=');
            if (supportedParams.indexOf(tokens[0]) !== -1) {
                result[tokens[0]] = tokens[1];
            }
            return result;
        }, result.oauthParams);

        return result;
    }

    function decodeToken(str) {
        str = str.split('.')[1];

        str = str.replace(/-/g, '+');
        str = str.replace(/_/g, '/');
        switch (str.length % 4) {
            case 0:
                break;
            case 2:
                str += '==';
                break;
            case 3:
                str += '=';
                break;
            default:
                throw 'Invalid token';
        }

        str = decodeURIComponent(escape(atob(str)));

        str = JSON.parse(str);
        return str;
    }
})();
