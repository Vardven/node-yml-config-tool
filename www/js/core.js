/*
 * core.js — Clash YML 配置工具的核心逻辑（无 DOM 依赖，可在浏览器和 Node 中运行）
 * 包含：分享链接解析、国家检测、节点命名、分组/订阅的纯数据操作、YAML 生成。
 * 初始状态不含任何预置节点或订阅，仅有一个空的「默认」分组。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 工具函数
  // ---------------------------------------------------------------------------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isIp(host) {
    if (!host) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    if (host.indexOf(':') !== -1) return true; // IPv6
    return false;
  }

  function yamlQuote(s) {
    return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function yamlScalar(v) {
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    var s = String(v == null ? '' : v);
    // 简单值直接输出，含特殊字符时加引号
    if (/^[A-Za-z0-9._\-/]+$/.test(s)) return s;
    return yamlQuote(s);
  }

  function decodeBase64(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof atob === 'function') {
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
      return bin;
    }
    return Buffer.from(s, 'base64').toString('utf-8');
  }

  function emptyState() {
    return { nodes: [], groups: ['默认'], subscriptions: [] };
  }

  // ---------------------------------------------------------------------------
  // 国家检测：备注 > 域名后缀；CDN 前置 / 纯 IP 一律「无法确定」，不猜
  // ---------------------------------------------------------------------------
  var COUNTRY_PATTERNS = [
    { loc: '日本', codes: ['JP', 'JPN'], words: ['日本', 'Japan', 'Tokyo', 'Osaka', '东京', '大阪'] },
    { loc: '美国', codes: ['US', 'USA'], words: ['美国', 'United States', 'America', 'Los Angeles', 'New York', 'Chicago', 'Seattle', 'Dallas', '洛杉矶', '纽约', '西雅图'] },
    { loc: '香港', codes: ['HK', 'HKG'], words: ['香港', 'Hong Kong', 'HongKong'] },
    { loc: '台湾', codes: ['TW', 'TWN'], words: ['台湾', '台灣', 'Taiwan', 'Taipei', '台北'] },
    { loc: '新加坡', codes: ['SG', 'SGP'], words: ['新加坡', 'Singapore', '狮城'] },
    { loc: '韩国', codes: ['KR', 'KOR'], words: ['韩国', '韓國', 'Korea', 'Seoul', '首尔', '首爾'] },
    { loc: '英国', codes: ['GB', 'UK', 'GBR'], words: ['英国', '英國', 'United Kingdom', 'Britain', 'London', '伦敦'] },
    { loc: '德国', codes: ['DE', 'DEU'], words: ['德国', '德國', 'Germany', 'Frankfurt', '法兰克福'] },
    { loc: '法国', codes: ['FR', 'FRA'], words: ['法国', '法國', 'France', 'Paris', '巴黎'] },
    { loc: '加拿大', codes: ['CA', 'CAN'], words: ['加拿大', 'Canada', 'Toronto', '多伦多'] },
    { loc: '澳大利亚', codes: ['AU', 'AUS'], words: ['澳大利亚', '澳洲', 'Australia', 'Sydney', '悉尼'] },
    { loc: '荷兰', codes: ['NL', 'NLD'], words: ['荷兰', 'Netherlands', 'Amsterdam'] },
    { loc: '印度', codes: ['IN', 'IND'], words: ['印度', 'India', 'Mumbai'] },
    { loc: '俄罗斯', codes: ['RU', 'RUS'], words: ['俄罗斯', 'Russia', 'Moscow'] },
    { loc: '巴西', codes: ['BR', 'BRA'], words: ['巴西', 'Brazil'] },
    { loc: '中国', codes: ['CN', 'CHN'], words: ['中国', 'China'] }
  ];

  var TLD_MAP = {
    jp: '日本', de: '德国', uk: '英国', gb: '英国', tw: '台湾', hk: '香港',
    sg: '新加坡', kr: '韩国', us: '美国', fr: '法国', ca: '加拿大',
    au: '澳大利亚', nl: '荷兰', in: '印度', br: '巴西', ru: '俄罗斯',
    ch: '瑞士', se: '瑞典', it: '意大利', es: '西班牙', cn: '中国'
  };

  // 常见 CDN / 前置入口的主机名特征：命中时无法判断真实出口国家
  var CDN_MARKERS = ['cloudflare', 'cloudfront', 'akamai', 'fastly', 'bunnycdn', 'gcore', 'cdn.', '.cdn', 'cdn-', 'edge.', 'edgesuite'];

  function detectCountry(input) {
    var remark = (input && input.remark) || '';
    var server = ((input && input.server) || '').toLowerCase();

    // 1) 备注里的国家代码 / 国家名优先
    if (remark) {
      var up = remark.toUpperCase();
      for (var i = 0; i < COUNTRY_PATTERNS.length; i++) {
        var c = COUNTRY_PATTERNS[i];
        var hit = c.codes.some(function (code) {
          return new RegExp('(^|[^A-Z])' + code + '([^A-Z]|$)').test(up);
        }) || c.words.some(function (w) { return remark.indexOf(w) !== -1; });
        if (hit) return { location: c.loc, source: 'remark', note: '按链接备注检测为「' + c.loc + '」' };
      }
    }

    // 2) CDN 前置入口：无法确定
    for (var j = 0; j < CDN_MARKERS.length; j++) {
      if (server.indexOf(CDN_MARKERS[j]) !== -1) {
        return { location: null, source: 'cdn', note: '服务器像是 CDN 前置入口，无法确定真实出口国家，请手动填写地点' };
      }
    }

    // 3) 纯 IP：无法确定（不做 IP 地理猜测）
    if (isIp(server)) {
      return { location: null, source: 'unknown', note: '服务器是纯 IP，无法自动确定国家，请手动填写地点' };
    }

    // 4) 域名后缀
    var m = server.match(/\.([a-z]{2})$/);
    if (m && TLD_MAP[m[1]]) {
      return { location: TLD_MAP[m[1]], source: 'tld', note: '按域名后缀 .' + m[1] + ' 检测为「' + TLD_MAP[m[1]] + '」' };
    }

    return { location: null, source: 'unknown', note: '无法自动确定国家，请手动填写地点' };
  }

  // ---------------------------------------------------------------------------
  // 分享链接解析
  // ---------------------------------------------------------------------------
  function parseShareLink(raw) {
    // 分享链接里不会有合法的空白字符；来源页面常把 IP/域名写成「18. 118. 164. 154」这种带空格的形式，
    // 复制时还会断行，先把所有空白（空格、换行、制表符）去掉再解析。
    var link = String(raw || '').replace(/\s+/g, '');
    if (!link) return { ok: false, error: '链接为空' };
    var scheme = (link.match(/^([a-zA-Z0-9]+):\/\//) || [])[1];
    if (!scheme) return { ok: false, error: '无法识别协议' };
    scheme = scheme.toLowerCase();
    try {
      if (scheme === 'vmess') return parseVmess(link);
      if (scheme === 'ss') return parseSs(link);
      return parseUrlStyle(link, scheme);
    } catch (e) {
      return { ok: false, error: '解析失败：' + e.message };
    }
  }

  function finishParse(node) {
    var det = detectCountry({ remark: node.remark, server: node.server });
    node.suggestedLocation = det.location;
    node.locationSource = det.source;
    node.locationNote = det.note;
    node.ok = true;
    return node;
  }

  function parseUrlStyle(link, scheme) {
    var typeMap = { vless: 'vless', trojan: 'trojan', hysteria2: 'hysteria2', hy2: 'hysteria2', tuic: 'tuic', anytls: 'anytls' };
    var type = typeMap[scheme];
    if (!type) return { ok: false, error: '暂不支持的协议：' + scheme };
    // 不依赖 new URL()：部分浏览器/桌面壳（旧版 Chromium 等）对 vless/tuic/anytls 这类
    // 非标准协议只解析出 query 参数，hostname/port/userinfo 一律返回空、端口回落 443。
    // 这里按 scheme://userinfo@host:port?query#remark 结构全部手动拆解，任何环境结果一致。
    function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
    var rest = link.slice(link.indexOf('://') + 3);
    var remark = '';
    var hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) { remark = safeDecode(rest.slice(hashIdx + 1)); rest = rest.slice(0, hashIdx); }
    var queryStr = '';
    var qIdx = rest.indexOf('?');
    if (qIdx !== -1) { queryStr = rest.slice(qIdx + 1); rest = rest.slice(0, qIdx); }
    var slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) rest = rest.slice(0, slashIdx);
    var q = new URLSearchParams(queryStr);
    var userinfo = '';
    var hostport = rest;
    var atIdx = rest.lastIndexOf('@');
    if (atIdx !== -1) { userinfo = rest.slice(0, atIdx); hostport = rest.slice(atIdx + 1); }
    var host = '', port = NaN;
    if (hostport.charAt(0) === '[') {
      var rb = hostport.indexOf(']');
      host = hostport.slice(1, rb);
      var tail = hostport.slice(rb + 1);
      if (tail.charAt(0) === ':') port = parseInt(tail.slice(1), 10);
    } else {
      var cIdx = hostport.lastIndexOf(':');
      if (cIdx !== -1 && /^\d+$/.test(hostport.slice(cIdx + 1))) { host = hostport.slice(0, cIdx); port = parseInt(hostport.slice(cIdx + 1), 10); }
      else host = hostport;
    }
    host = host.toLowerCase();
    var cred = safeDecode(userinfo);
    var urlPw = '';
    var rawColon = userinfo.indexOf(':');
    if (rawColon !== -1) { cred = safeDecode(userinfo.slice(0, rawColon)); urlPw = safeDecode(userinfo.slice(rawColon + 1)); }
    var details = {};
    if (type === 'vless') details.uuid = cred;
    else if (type === 'tuic') {
      // tuic 的凭据是 uuid:password，冒号可能被编码成 %3A 混在 username 里，也可能明文分隔
      if (urlPw) { details.uuid = cred; details.password = urlPw; }
      else {
        var ci = cred.indexOf(':');
        if (ci !== -1) { details.uuid = cred.slice(0, ci); details.password = cred.slice(ci + 1); }
        else details.uuid = cred;
      }
    } else details.password = urlPw ? cred + ':' + urlPw : cred;

    var network = q.get('type') || q.get('network') || 'tcp';
    details.network = network;
    var security = q.get('security') || '';
    if (security === 'tls' || security === 'reality' || q.get('tls') === '1') details.tls = true;
    var sni = q.get('sni') || q.get('peer') || q.get('servername') || '';
    if (sni) { details.servername = sni; details.sni = sni; }
    var fp = q.get('fp') || q.get('fingerprint') || '';
    if (fp) details.clientFingerprint = fp;
    var flow = q.get('flow') || '';
    if (flow) details.flow = flow;
    var alpn = q.get('alpn') || '';
    if (alpn) details.alpn = alpn.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (q.get('allowInsecure') === '1' || q.get('insecure') === '1' || q.get('allow_insecure') === '1') details.skipCertVerify = true;

    // 传输层参数（ws / grpc / h2 / xhttp 等通用保存）
    var tHost = q.get('host') || '';
    var tPath = q.get('path') || '';
    var tMode = q.get('mode') || '';
    var tService = q.get('serviceName') || '';
    if (tHost) details.transportHost = tHost;
    if (tPath) { try { details.transportPath = decodeURIComponent(tPath); } catch (e) { details.transportPath = tPath; } }
    if (tMode) details.transportMode = tMode;
    if (tService) details.transportServiceName = tService;

    // Reality
    var pbk = q.get('pbk') || q.get('publicKey') || '';
    var sid = q.get('sid') || q.get('shortId') || '';
    if (pbk) details.realityPublicKey = pbk;
    if (sid) details.realityShortId = sid;

    // tuic 额外参数
    if (type === 'tuic') {
      var cc = q.get('congestion_control') || q.get('congestionController') || '';
      if (cc) details.congestionController = cc;
      var urm = q.get('udp_relay_mode') || '';
      if (urm) details.udpRelayMode = urm;
    }
    // hysteria2 额外参数
    if (type === 'hysteria2') {
      var obfs = q.get('obfs') || '';
      var obfsPw = q.get('obfs-password') || q.get('obfsParam') || '';
      if (obfs) details.obfs = obfs;
      if (obfsPw) details.obfsPassword = obfsPw;
    }

    return finishParse({
      type: type,
      server: host,
      port: port || 443,
      details: details,
      remark: remark
    });
  }

  function parseVmess(link) {
    var body = link.replace(/^vmess:\/\//, '').split('#')[0].split('?')[0];
    var json = JSON.parse(decodeBase64(body));
    var details = {
      uuid: json.id || '',
      alterId: parseInt(json.aid || '0', 10) || 0,
      cipher: json.scy || 'auto',
      network: json.net || 'tcp'
    };
    if (json.tls === 'tls' || json.tls === true) details.tls = true;
    var sni = json.sni || json.host || '';
    if (json.sni) details.servername = json.sni;
    if (json.host) details.transportHost = json.host;
    if (json.path) details.transportPath = json.path;
    if (json.fp) details.clientFingerprint = json.fp;
    if (sni && !details.sni) details.sni = sni;
    return finishParse({
      type: 'vmess',
      server: json.add || '',
      port: parseInt(json.port, 10) || 443,
      details: details,
      remark: json.ps || ''
    });
  }

  function parseSs(link) {
    var rest = link.replace(/^ss:\/\//, '');
    var remark = '';
    var hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) { remark = decodeURIComponent(rest.slice(hashIdx + 1)); rest = rest.slice(0, hashIdx); }
    rest = rest.split('?')[0];
    var method = '', password = '', hostport = '';
    if (rest.indexOf('@') !== -1) {
      var at = rest.lastIndexOf('@');
      var userinfo = rest.slice(0, at);
      hostport = rest.slice(at + 1);
      try { userinfo = decodeBase64(userinfo); } catch (e) { userinfo = decodeURIComponent(userinfo); }
      var colon = userinfo.indexOf(':');
      method = userinfo.slice(0, colon);
      password = userinfo.slice(colon + 1);
    } else {
      var decoded = decodeBase64(rest);
      var m = decoded.match(/^([^:]+):(.+)@(.+)$/);
      if (!m) return { ok: false, error: 'ss 链接格式无法解析' };
      method = m[1]; password = m[2]; hostport = m[3];
    }
    var hp = hostport.match(/^(.+):(\d+)$/);
    if (!hp) return { ok: false, error: 'ss 链接缺少地址或端口' };
    return finishParse({
      type: 'ss',
      server: hp[1].replace(/^\[|\]$/g, ''),
      port: parseInt(hp[2], 10),
      details: { method: method, cipher: method, password: password },
      remark: remark
    });
  }

  // ---------------------------------------------------------------------------
  // 节点命名与 YAML
  // ---------------------------------------------------------------------------
  function buildNodeName(node) {
    var parts = [node.groupName, node.location, node.server, String(node.port)];
    if (node.suffix) parts.push(node.suffix);
    return parts.join('|');
  }

  function nodeYaml(node) {
    var d = node.details || {};
    var lines = [];
    lines.push('  - name: ' + yamlQuote(buildNodeName(node)));
    lines.push('    type: ' + node.type);
    lines.push('    server: ' + (isIp(node.server) && node.server.indexOf(':') !== -1 ? yamlQuote(node.server) : yamlScalar(node.server)));
    lines.push('    port: ' + node.port);

    function put(key, val) {
      if (val === undefined || val === null || val === '') return;
      lines.push('    ' + key + ': ' + yamlScalar(val));
    }
    function putBool(key, val) { if (val) lines.push('    ' + key + ': true'); }

    if (node.type === 'vless' || node.type === 'vmess' || node.type === 'tuic') put('uuid', d.uuid);
    if (node.type === 'vmess') {
      lines.push('    alterId: ' + (d.alterId || 0));
      put('cipher', d.cipher || 'auto');
    }
    if (['trojan', 'hysteria2', 'anytls', 'ss'].indexOf(node.type) !== -1) put('password', d.password);
    if (node.type === 'ss') put('cipher', d.method || d.cipher);
    if (node.type === 'tuic') put('password', d.password || d.uuid);

    if (d.network && node.type !== 'hysteria2' && node.type !== 'anytls' && node.type !== 'ss') put('network', d.network);
    putBool('tls', d.tls);
    if (d.servername) put('servername', d.servername);
    else if (d.sni && ['vless', 'vmess'].indexOf(node.type) !== -1) put('servername', d.sni);
    if (d.sni && ['trojan', 'hysteria2', 'tuic', 'anytls'].indexOf(node.type) !== -1) put('sni', d.sni);
    if (d.flow) put('flow', d.flow);
    if (d.clientFingerprint) put('client-fingerprint', d.clientFingerprint);
    if (d.alpn && d.alpn.length) lines.push('    alpn: [' + d.alpn.join(', ') + ']');
    putBool('skip-cert-verify', d.skipCertVerify);

    if (d.realityPublicKey) {
      lines.push('    reality-opts:');
      lines.push('      public-key: ' + yamlScalar(d.realityPublicKey));
      if (d.realityShortId) lines.push('      short-id: ' + yamlScalar(d.realityShortId));
    }

    // 传输层 opts
    var net = d.network || '';
    if (net === 'ws') {
      lines.push('    ws-opts:');
      if (d.transportPath) lines.push('      path: ' + yamlScalar(d.transportPath));
      if (d.transportHost) {
        lines.push('      headers:');
        lines.push('        Host: ' + yamlScalar(d.transportHost));
      }
    } else if (net === 'grpc') {
      lines.push('    grpc-opts:');
      if (d.transportServiceName) lines.push('      grpc-service-name: ' + yamlScalar(d.transportServiceName));
    } else if (net === 'h2') {
      lines.push('    h2-opts:');
      if (d.transportHost) lines.push('      host: [' + yamlScalar(d.transportHost) + ']');
      if (d.transportPath) lines.push('      path: ' + yamlScalar(d.transportPath));
    } else if (net === 'xhttp') {
      lines.push('    xhttp-opts:');
      if (d.transportPath) lines.push('      path: ' + yamlScalar(d.transportPath));
      if (d.transportHost) lines.push('      host: ' + yamlScalar(d.transportHost));
      if (d.transportMode) lines.push('      mode: ' + yamlScalar(d.transportMode));
    }

    if (node.type === 'tuic') {
      if (d.congestionController) put('congestion-controller', d.congestionController);
      if (d.udpRelayMode) put('udp-relay-mode', d.udpRelayMode);
    }
    if (node.type === 'hysteria2') {
      if (d.obfs) put('obfs', d.obfs);
      if (d.obfsPassword) put('obfs-password', d.obfsPassword);
    }
    if (node.type !== 'ss') lines.push('    udp: true');
    else lines.push('    udp: true');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 状态操作（纯函数，UI 与测试共用）
  // ---------------------------------------------------------------------------
  function listGroups(state) {
    var counts = {};
    state.nodes.forEach(function (n) { counts[n.groupName] = (counts[n.groupName] || 0) + 1; });
    var names = {};
    state.groups.forEach(function (g) { names[g] = true; });
    Object.keys(counts).forEach(function (g) { names[g] = true; });
    return Object.keys(names).sort().map(function (name) {
      return { name: name, count: counts[name] || 0, custom: state.groups.indexOf(name) !== -1 };
    });
  }

  function addGroup(state, name) {
    name = String(name || '').trim();
    if (!name) return { ok: false, error: '分组名不能为空' };
    if (name.indexOf('|') !== -1) return { ok: false, error: '分组名不能包含「|」' };
    if (listGroups(state).some(function (g) { return g.name === name; })) return { ok: false, error: '分组「' + name + '」已经存在' };
    state.groups.push(name);
    return { ok: true };
  }

  function renameGroup(state, oldName, newName) {
    newName = String(newName || '').trim();
    if (!newName) return { ok: false, error: '新分组名不能为空' };
    if (newName.indexOf('|') !== -1) return { ok: false, error: '分组名不能包含「|」' };
    var exists = listGroups(state).some(function (g) { return g.name === oldName; });
    if (!exists) return { ok: false, error: '分组「' + oldName + '」不存在' };
    if (newName !== oldName && listGroups(state).some(function (g) { return g.name === newName; })) {
      return { ok: false, error: '分组「' + newName + '」已经存在' };
    }
    var updated = 0;
    state.nodes.forEach(function (n) { if (n.groupName === oldName) { n.groupName = newName; updated++; } });
    var idx = state.groups.indexOf(oldName);
    if (idx !== -1) state.groups[idx] = newName;
    return { ok: true, updatedNodes: updated };
  }

  function deleteGroup(state, name) {
    var count = state.nodes.filter(function (n) { return n.groupName === name; }).length;
    if (count > 0) return { ok: false, error: '分组「' + name + '」里还有 ' + count + ' 个节点，请先把节点移到其它分组或删掉' };
    state.groups = state.groups.filter(function (g) { return g !== name; });
    return { ok: true };
  }

  function addNode(state, node) {
    node.name = buildNodeName(node);
    if (state.nodes.some(function (n) { return buildNodeName(n) === node.name; })) {
      return { ok: false, error: '节点名重复：' + node.name + '（同分组同地址同端口时，请加第 5 段后缀区分）' };
    }
    node.id = node.id || uid();
    state.nodes.push(node);
    if (state.groups.indexOf(node.groupName) === -1) state.groups.push(node.groupName);
    return { ok: true, node: node };
  }

  // ---------------------------------------------------------------------------
  // 订阅
  // ---------------------------------------------------------------------------
  function autoSubName(url) {
    try {
      var h = new URL(url).hostname.replace(/^www\./, '');
      return h || 'subscription';
    } catch (e) { return 'subscription'; }
  }

  function maskUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol + '//' + u.hostname + '/••••••';
    } catch (e) { return '••••••'; }
  }

  function addSubscription(state, name, url) {
    url = String(url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: '不是有效的 http(s) 链接' };
    if (state.subscriptions.some(function (s) { return s.url === url; })) return { ok: false, error: '该订阅链接已经存在' };
    name = String(name || '').trim() || autoSubName(url);
    if (state.subscriptions.some(function (s) { return s.name === name; })) return { ok: false, error: '订阅名「' + name + '」已经存在' };
    var sub = { id: uid(), name: name, url: url };
    state.subscriptions.push(sub);
    return { ok: true, sub: sub };
  }

  function parseBulkSubscriptions(state, text) {
    var added = [], skipped = [];
    String(text || '').split(/\r?\n/).forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) return;
      var m = line.match(/https?:\/\/\S+/i);
      if (!m) { skipped.push({ line: line, reason: '没有找到链接' }); return; }
      var url = m[0];
      var name = line.slice(0, m.index).replace(/[:：\-—\s]+$/, '').trim();
      var res = addSubscription(state, name, url);
      if (res.ok) added.push(res.sub);
      else skipped.push({ line: line, reason: res.error });
    });
    return { added: added, skipped: skipped };
  }

  // ---------------------------------------------------------------------------
  // 完整 YAML 导出（通用模板 + 用户自己的节点与订阅）
  // ---------------------------------------------------------------------------
  function generateFullYaml(state) {
    var subs = state.subscriptions || [];
    var out = [];
    out.push('# 由「Clash YML 配置工具」生成 —— Clash / mihomo 配置');
    out.push('# 节点、分组与订阅都由使用者自行添加，工具本身不含任何预置数据。');
    out.push('');

    // 锚点
    var prList = '[🚀 节点选择, ♻️ 自动选择, 🌐 全部节点, 🇭🇰香港节点, 🇨🇳台湾节点, 🇯🇵日本节点, 🇸🇬新加坡节点, 🇰🇷韩国节点, 🇺🇲美国节点, 🇩🇪德国节点, 🇬🇧英国节点, 🧿其它地区, DIRECT]';
    out.push('pr: &pr {type: select, proxies: ' + prList + '}');
    if (subs.length) {
      var useList = subs.map(function (s) { return s.name; }).join(', ');
      out.push('best: &best {type: url-test, interval: 300, tolerance: 50, lazy: true, use: [' + useList + ']}');
    } else {
      out.push('best: &best {type: url-test, interval: 300, tolerance: 50, lazy: true}');
    }
    out.push('');

    // 订阅来源
    if (subs.length) {
      out.push('proxy-providers:');
      subs.forEach(function (s) {
        out.push('  ' + yamlScalar(s.name) + ':');
        out.push('    type: http');
        out.push('    interval: 1800');
        out.push('    health-check:');
        out.push('      enable: true');
        out.push('      url: https://www.gstatic.com/generate_204');
        out.push('      interval: 300');
        out.push('    proxy: DIRECT');
        out.push('    url: ' + yamlQuote(s.url));
        out.push('    override:');
        out.push('      skip-cert-verify: true');
        out.push('      udp: true');
      });
      out.push('');
    }
    out.push('global-ua: clash.meta');
    out.push('');

    // 全局
    out.push('external-controller: 127.0.0.1:9090');
    out.push('mixed-port: 7890');
    out.push('allow-lan: true');
    out.push('mode: rule');
    out.push('log-level: info');
    out.push('ipv6: false');
    out.push('');

    // sniffer
    out.push('sniffer:');
    out.push('  enable: true');
    out.push('  sniff:');
    out.push('    HTTP:');
    out.push('      ports: [80, 8080-8880]');
    out.push('      override-destination: true');
    out.push('    TLS:');
    out.push('      ports: [443, 8443]');
    out.push('    QUIC:');
    out.push('      ports: [443, 8443]');
    out.push('');

    // tun
    out.push('tun:');
    out.push('  enable: true');
    out.push('  stack: mixed');
    out.push('  mtu: 9000');
    out.push('  dns-hijack:');
    out.push('    - "any:53"');
    out.push('    - "tcp://any:53"');
    out.push('  auto-route: true');
    out.push('  auto-redirect: true');
    out.push('  auto-detect-interface: true');
    out.push('');

    // dns
    out.push('dns:');
    out.push('  enable: true');
    out.push('  listen: 0.0.0.0:53');
    out.push('  ipv6: false');
    out.push('  default-nameserver:');
    out.push('    - 180.76.76.76');
    out.push('    - 119.29.29.29');
    out.push('    - 223.5.5.5');
    out.push('    - 1.2.4.8');
    out.push('  enhanced-mode: fake-ip');
    out.push('  fake-ip-range: 198.18.0.1/16');
    out.push('  nameserver:');
    out.push('    - https://doh.pub/dns-query');
    out.push('    - https://223.5.5.5/dns-query');
    out.push('    - https://dns.alidns.com/dns-query');
    out.push('  fallback:');
    out.push('    - https://1.1.1.1/dns-query');
    out.push('    - https://1.0.0.1/dns-query');
    out.push('    - 8.8.8.8');
    out.push('    - 8.8.4.4');
    out.push('    - tls://1.0.0.1:853');
    out.push('    - tls://dns.google:853');
    out.push('  fallback-filter:');
    out.push('    geoip: true');
    out.push('    geoip-code: CN');
    out.push('    ipcidr:');
    out.push('      - 0.0.0.0/8');
    out.push('      - 10.0.0.0/8');
    out.push('      - 100.64.0.0/10');
    out.push('      - 127.0.0.0/8');
    out.push('      - 169.254.0.0/16');
    out.push('      - 172.16.0.0/12');
    out.push('      - 192.168.0.0/16');
    out.push('      - 198.18.0.0/15');
    out.push('      - 224.0.0.0/4');
    out.push('      - 240.0.0.0/4');
    out.push('');

    // proxies
    if (state.nodes.length) {
      out.push('proxies:');
      // 按分组、添加顺序输出
      state.nodes.forEach(function (n) { out.push(nodeYaml(n)); });
    } else {
      out.push('proxies: []');
    }
    out.push('');

    // proxy-groups
    out.push('proxy-groups:');
    out.push('  - {name: 🚀 节点选择, type: select, proxies: [♻️ 自动选择, 🌐 全部节点, 🇭🇰香港节点, 🇨🇳台湾节点, 🇯🇵日本节点, 🇸🇬新加坡节点, 🇰🇷韩国节点, 🇺🇲美国节点, 🇩🇪德国节点, 🇬🇧英国节点, 🧿其它地区, DIRECT]}');
    out.push('  - {name: ♻️ 自动选择, type: url-test, include-all: true, tolerance: 20, interval: 300, lazy: true, filter: "^((?!(DIRECT)).)*$"}');
    out.push('  - {name: ☢ 负载均衡-散列, type: load-balance, strategy: consistent-hashing, <<: *best, filter: "^((?!(DIRECT)).)*$"}');
    out.push('  - {name: ☢ 负载均衡-轮询, type: load-balance, strategy: round-robin, <<: *best, filter: "^((?!(DIRECT)).)*$"}');
    out.push('  - {name: 🌐 全部节点, type: select, include-all: true}');
    ['📹 YouTube', '🍀 Google', '🤖 AI', '📲 Telegram', '🎥 NETFLIX', '🎵 Spotify', '🎵 TikTok', '🪟 Microsoft', '🐬 OneDrive', '📖 Notion', '💶 PayPal', '📹 哔哩哔哩'].forEach(function (name) {
      out.push('  - {name: ' + name + ', <<: *pr}');
    });
    out.push('  - {name: 🍎 Apple, type: select, proxies: [DIRECT, 🚀 节点选择, ♻️ 自动选择, 🌐 全部节点]}');
    out.push('  - {name: 🎯 全球直连, type: select, proxies: [DIRECT, 🚀 节点选择]}');
    out.push('  - {name: 🐟 漏网之鱼, <<: *pr}');
    var regions = [
      ['🇭🇰香港节点', '港|HK|hk|Hong Kong|HongKong|hongkong'],
      ['🇨🇳台湾节点', '台|新北|彰化|TW|Taiwan'],
      ['🇯🇵日本节点', '日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan'],
      ['🇸🇬新加坡节点', '新加坡|坡|狮城|SG|Singapore'],
      ['🇰🇷韩国节点', 'KR|Korea|KOR|首尔|韩|韓'],
      ['🇺🇲美国节点', '美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|US|United States'],
      ['🇩🇪德国节点', '德国|DE|Germany'],
      ['🇬🇧英国节点', '英国|GB|Great Britain']
    ];
    regions.forEach(function (r) {
      out.push('  - {name: ' + r[0] + ', type: url-test, include-all: true, tolerance: 20, interval: 300, filter: "' + r[1] + '"}');
    });
    out.push('  - {name: 🧿其它地区, type: select, include-all: true, filter: "(?i)^(?!.*(?:港|hk|hongkong|台|tw|taiwan|日|jp|japan|新加坡|sg|singapore|美|us|unitedstates|英国|gb|great britain|德国|de|germany|kr|korea|首尔|韩|韓)).*"}');
    out.push('');

    // rules
    out.push('rules:');
    [
      ['apple_domain', '🍎 Apple'], ['ai_domain', '🤖 AI'], ['bilibili_domain', '📹 哔哩哔哩'],
      ['spotify_domain', '🎵 Spotify'], ['youtube_domain', '📹 YouTube'], ['google_domain', '🍀 Google'],
      ['onedrive_domain', '🐬 OneDrive'], ['microsoft_domain', '🪟 Microsoft'], ['tiktok_domain', '🎵 TikTok'],
      ['telegram_domain', '📲 Telegram'], ['netflix_domain', '🎥 NETFLIX'], ['notion_domain', '📖 Notion'],
      ['paypal_domain', '💶 PayPal']
    ].forEach(function (r) { out.push('  - RULE-SET,' + r[0] + ',' + r[1]); });
    out.push('  - RULE-SET,geolocation-!cn,🚀 节点选择');
    out.push('  - RULE-SET,cn_domain,🎯 全球直连');
    out.push('  - RULE-SET,google_ip,🍀 Google,no-resolve');
    out.push('  - RULE-SET,netflix_ip,🎥 NETFLIX,no-resolve');
    out.push('  - RULE-SET,telegram_ip,📲 Telegram,no-resolve');
    out.push('  - RULE-SET,cn_ip,🎯 全球直连');
    out.push('  - MATCH,🐟 漏网之鱼');
    out.push('');

    // rule-providers（MetaCubeX 公开规则库）
    out.push('rule-anchor:');
    out.push('  ip: &ip {type: http, interval: 86400, behavior: ipcidr, format: mrs}');
    out.push('  domain: &domain {type: http, interval: 86400, behavior: domain, format: mrs}');
    out.push('');
    out.push('rule-providers:');
    var base = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/';
    var geoip = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/';
    var domainProviders = {
      private_domain: 'private.mrs', bilibili_domain: 'bilibili.mrs', spotify_domain: 'spotify.mrs',
      youtube_domain: 'youtube.mrs', google_domain: 'google.mrs', telegram_domain: 'telegram.mrs',
      netflix_domain: 'netflix.mrs', notion_domain: 'notion.mrs', paypal_domain: 'paypal.mrs',
      onedrive_domain: 'onedrive.mrs', microsoft_domain: 'microsoft.mrs', apple_domain: 'apple-cn.mrs',
      tiktok_domain: 'tiktok.mrs', ai_domain: 'ai.mrs',
      'geolocation-!cn': 'geolocation-!cn.mrs', cn_domain: 'cn.mrs'
    };
    Object.keys(domainProviders).forEach(function (k) {
      out.push('  ' + k + ': { <<: *domain, url: "' + base + domainProviders[k] + '" }');
    });
    var ipProviders = { cn_ip: 'cn.mrs', google_ip: 'google.mrs', telegram_ip: 'telegram.mrs', netflix_ip: 'netflix.mrs' };
    Object.keys(ipProviders).forEach(function (k) {
      out.push('  ' + k + ': { <<: *ip, url: "' + geoip + ipProviders[k] + '" }');
    });
    out.push('');
    return out.join('\n');
  }

  var Core = {
    uid: uid,
    isIp: isIp,
    emptyState: emptyState,
    detectCountry: detectCountry,
    parseShareLink: parseShareLink,
    buildNodeName: buildNodeName,
    nodeYaml: nodeYaml,
    listGroups: listGroups,
    addGroup: addGroup,
    renameGroup: renameGroup,
    deleteGroup: deleteGroup,
    addNode: addNode,
    autoSubName: autoSubName,
    maskUrl: maskUrl,
    addSubscription: addSubscription,
    parseBulkSubscriptions: parseBulkSubscriptions,
    generateFullYaml: generateFullYaml
  };

  global.NodeYmlCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
