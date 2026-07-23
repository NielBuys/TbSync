/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);

var tbsyncExtension = ExtensionParent.GlobalManager.getExtension(
  "tbsync@jobisoft.de"
);
var { TbSync } = ChromeUtils.importESModule(
  `chrome://tbsync/content/tbsync.sys.mjs?${tbsyncExtension.manifest.version}`
);

var passwordManager = {

  load: async function () {
  },

  unload: async function () {
  },

  // Thunderbird 153 removed the synchronous Services.logins.findLogins()
  // (it now throws NS_ERROR_NOT_IMPLEMENTED). searchLoginsAsync() is the
  // replacement. matchData mirrors findLogins(origin, null, realm): match by
  // origin + httpRealm, leaving formActionOrigin unset so it acts as a wildcard.
  _searchLogins: async function(origin, realm) {
    // searchLoginsAsync() takes a plain matchData object (not an nsIPropertyBag,
    // which is what the deprecated synchronous searchLogins() expects). Matching
    // by origin + httpRealm and omitting formActionOrigin mirrors the old
    // findLogins(origin, null, realm) call.
    return await Services.logins.searchLoginsAsync({ origin, httpRealm: realm });
  },

  removeLoginInfos: async function(origin, realm, users = null) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");

    let logins = await this._searchLogins(origin, realm);
    for (let i = 0; i < logins.length; i++) {
      if (!users || users.includes(logins[i].username)) {
        let currentLoginInfo = new nsLoginInfo(origin, null, realm, logins[i].username, logins[i].password, "", "");
        try {
          Services.logins.removeLogin(currentLoginInfo);
        } catch (e) {
          TbSync.dump("Error removing loginInfo", e);
        }
      }
    }
  },

  updateLoginInfo: async function(origin, realm, oldUser, newUser, newPassword) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    
    await this.removeLoginInfos(origin, realm, [oldUser, newUser]);
    
    let newLoginInfo = new nsLoginInfo(origin, null, realm, newUser, newPassword, "", "");
    try {
      await Services.logins.addLoginAsync(newLoginInfo);
    } catch (e) {
      TbSync.dump("Error adding loginInfo", e);
    }
  },
  
  getLoginInfo: async function(origin, realm, user) {
    let logins = await this._searchLogins(origin, realm);
    for (let i = 0; i < logins.length; i++) {
      if (logins[i].username == user) {
        return logins[i].password;
      }
    }
    return null;
  },

  
  /** data obj
    windowID
    accountName
    userName
    userNameLocked
  
  reference is an object in which an entry with windowID will be placed to hold a reference to the prompt window (so it can be closed externaly)
  */
  asyncPasswordPrompt: async function(data, reference) {
    if (data.windowID) {
      const url = "chrome://tbsync/content/passwordPrompt/passwordPrompt.xhtml";
      const window = Services.wm.getMostRecentWindow("mail:3pane");

      return await new Promise(function(resolve, reject) {
       reference[data.windowID] = window.openDialog(url, "TbSyncPasswordPrompt:" + data.windowID, "centerscreen,chrome,resizable=no", data, resolve);
      });
    }
    
    return false;
  }
}
