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
  "tbsync@nielbuys.fork"
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
    let logins = await this._searchLogins(origin, realm);
    for (let i = 0; i < logins.length; i++) {
      if (!users || users.includes(logins[i].username)) {
        try {
          // TB153 removed the synchronous removeLogin(); removeLoginAsync() is
          // the replacement. Pass the actual stored login (it carries the GUID)
          // so it reliably matches and deletes.
          await Services.logins.removeLoginAsync(logins[i]);
        } catch (e) {
          TbSync.dump("Error removing loginInfo", e);
        }
      }
    }
  },

  updateLoginInfo: async function(origin, realm, oldUser, newUser, newPassword) {
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    let newLoginInfo = new nsLoginInfo(origin, null, realm, newUser, newPassword, "", "");

    // Atomically replace the existing login in place. The previous
    // remove-then-add approach could silently fail: if removeLogin did not
    // match the stored entry, addLoginAsync then rejected as a duplicate and
    // the error was swallowed, leaving the OLD password (e.g. a stale OAuth
    // token) in storage forever. modifyLogin replaces all fields on the stored
    // login (matched by GUID), so the new value always lands.
    let logins = await this._searchLogins(origin, realm);
    let existing = logins.find(l => l.username == oldUser || l.username == newUser);
    if (existing) {
      try {
        // TB153 removed the synchronous modifyLogin(); modifyLoginAsync() is the
        // replacement. Replaces all fields on the stored login (matched by GUID).
        await Services.logins.modifyLoginAsync(existing, newLoginInfo);
        return;
      } catch (e) {
        TbSync.dump("Error modifying loginInfo", e);
      }
    }

    // No existing login (or modify failed): clear any leftovers and add fresh.
    await this.removeLoginInfos(origin, realm, [oldUser, newUser]);
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
