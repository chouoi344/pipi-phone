// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const MIB=1024*1024;
const sizeLabel=bytes=>bytes>=MIB?(bytes/MIB).toFixed(2)+' MB':(bytes/1024).toFixed(1)+' KB';
module.exports={sizeLabel};
