/* app.js — UI 层：状态存 localStorage，初始状态完全为空 */
(function () {
  'use strict';
  var Core = window.NodeYmlCore;
  var KEY = 'node-yml-config-tool-state-v1';
  var state = load();
  var editingNodeId = null;
  var revealSubs = {};

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.nodes) && Array.isArray(s.groups) && Array.isArray(s.subscriptions)) {
          return migrateState(s);
        }
      }
    } catch (e) { /* 忽略损坏的本地数据 */ }
    return Core.emptyState();
  }
  function migrateState(s) {
    // 旧版内置「默认」分组改为内置策略组「全部节点」
    s.groups = (s.groups || []).filter(function (g) { return g !== '默认' && g !== Core.ALL_GROUP; });
    s.nodes.forEach(function (n) { if (n.groupName === '默认') n.groupName = Core.ALL_GROUP; });
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    if (!s.settings.testUrl) s.settings.testUrl = Core.DEFAULT_TEST_URL;
    if (!Array.isArray(s.rules)) { s.rules = Core.defaultRules(); return s; }
    // 内置（默认）规则完全锁定：每次加载都按类型+值与出厂默认对齐——
    // 目标/no-resolve 被旧版本改过的强制改回（如 cn_ip 被改成香港节点组），缺失的默认规则按规范位置补回；
    // 用户自加规则（匹配不上默认签名的）原样保留，位置与名称不动。
    // 已退役的默认规则签名改名映射：ai_domain（≤v1.0.9 的写法）-> ai_ip
    var RETIRED = { 'RULE-SET|ai_domain': 'ai_ip' };
    s.rules.forEach(function (r) {
      var k = r.type + '|' + (r.payload || '');
      if (RETIRED[k]) r.payload = RETIRED[k];
    });
    var defs = Core.defaultRules();
    var canonIdx = {};
    defs.forEach(function (d, ix) { canonIdx[d.type + '|' + (d.payload || '')] = ix; });
    var present = {};
    s.rules.forEach(function (r) {
      var key = r.type + '|' + (r.payload || '');
      if (canonIdx[key] !== undefined && !present[key]) {
        var d = defs[canonIdx[key]];
        r.target = d.target;
        if (d.noResolve) r.noResolve = true; else delete r.noResolve;
        r.builtin = true;
        present[key] = true;
      } else {
        r.builtin = false;
      }
    });
    defs.forEach(function (d, ix) {
      var key = d.type + '|' + (d.payload || '');
      if (present[key]) return;
      var pos = s.rules.length;
      for (var i = 0; i < s.rules.length; i++) {
        var k2 = s.rules[i].type + '|' + (s.rules[i].payload || '');
        if (s.rules[i].builtin && canonIdx[k2] !== undefined && canonIdx[k2] > ix) { pos = i; break; }
      }
      var copy = {}; Object.keys(d).forEach(function (k) { copy[k] = d[k]; });
      s.rules.splice(pos, 0, copy);
      present[key] = true;
    });
    return s;
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function msg(el, text, ok) {
    el.textContent = text || '';
    el.className = 'msg ' + (ok ? 'ok' : 'err');
    applyI18n(el);
    if (text) toast(text, ok);
  }
  // 屏幕底部悬浮提示：pointer-events:none，不挡滑动和点击，几秒后自动消失
  var toastTimer = null;
  function toast(text, ok) {
    var el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text || '';
    el.className = 'toast show ' + (ok ? 'ok' : 'err');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2800);
  }
  var t = window.t || function (s) { return s; };
  function applyI18n(root) { if (window.i18nApply) window.i18nApply(root || document.body); }

  // ---------------------------------------------------------------- 节点列表
  function filteredNodeList() {
    var q = $('node-search').value.trim().toLowerCase();
    var gf = $('node-group-filter').value;
    var tf = $('node-type-filter').value;
    return state.nodes.filter(function (n) {
      if (gf && n.groupName !== gf) return false;
      if (tf && n.type !== tf) return false;
      if (q && (Core.buildNodeName(n) + ' ' + n.server).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function renderNodes() {
    var list = filteredNodeList();
    $('node-count').textContent = t('共 {0} 个节点', state.nodes.length) + (list.length !== state.nodes.length ? t('，筛选后 {0} 个', list.length) : '');
    $('node-empty').style.display = state.nodes.length ? 'none' : 'block';
    $('node-list').innerHTML = list.map(function (n) {
      var name = Core.buildNodeName(n);
      var badges = '<span class="badge">' + esc(n.type) + '</span>';
      if (testingIds[n.id]) {
        badges += '<span class="badge ping testing">测试中…</span>';
      } else if (n.test) {
        if (n.test.ok) badges += '<span class="badge ping ' + (n.test.delay < 300 ? 'ok' : (n.test.delay < 800 ? 'warn' : 'slow')) + '">' + n.test.delay + 'ms</span>';
        else badges += '<span class="badge ping bad">不通</span>';
        if (n.test.country) badges += '<span class="badge country">' + esc(n.test.country) + '</span>';
      }
      return '<div class="card">' +
        '<div class="card-head"><strong>' + esc(name) + '</strong><span class="badges">' + badges + '</span></div>' +
        '<pre class="yaml">' + esc(Core.nodeYaml(n)) + '</pre>' +
        '<div class="row">' +
        '<button data-act="link" data-id="' + n.id + '">复制链接</button>' +
        '<button data-act="test" data-id="' + n.id + '">测速</button>' +
        '<button data-act="edit" data-id="' + n.id + '">编辑</button>' +
        '<button data-act="del" data-id="' + n.id + '" class="danger">删除</button>' +
        '</div></div>';
    }).join('');
    var deadCount = state.nodes.filter(function (n) { return n.test && !n.test.ok; }).length;
    var ddBtn = $('del-dead-btn');
    if (ddBtn) {
      ddBtn.hidden = deadCount === 0;
      ddBtn.textContent = t('删除不通节点') + '（' + deadCount + '）';
    }
    // 分组筛选下拉
    var cur = $('node-group-filter').value;
    $('node-group-filter').innerHTML = '<option value="">全部分组</option>' + Core.listGroups(state).map(function (g) {
      return '<option value="' + esc(g.name) + '"' + (g.name === cur ? ' selected' : '') + '>' + esc(g.name) + '</option>';
    }).join('');
  }

  // ---------------------------------------------------------------- 节点测速（内置 mihomo 内核）
  var testingIds = {};
  var testRunning = false;
  var coreSession = null;

  function nativeBridge() {
    if (window.CoreBridge && window.CoreBridge.startCore) return window.CoreBridge;
    var cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins && cap.Plugins.AppTools) return cap.Plugins.AppTools;
    return null;
  }
  function testUrl() { return (state.settings && state.settings.testUrl) || Core.DEFAULT_TEST_URL; }
  function startCoreFor(nodes) {
    var bridge = nativeBridge();
    if (!bridge) return Promise.reject(new Error('nobridge'));
    var mixedPort = 17000 + Math.floor(Math.random() * 1500);
    var apiPort = mixedPort + 1000;
    var cfg = Core.buildTestConfig(nodes, mixedPort, apiPort);
    return bridge.startCore({ config: cfg, apiPort: apiPort, mixedPort: mixedPort }).then(function () {
      coreSession = { bridge: bridge, apiBase: 'http://127.0.0.1:' + apiPort, mixedPort: mixedPort };
      return coreSession;
    });
  }
  function stopCore() {
    if (coreSession && coreSession.bridge.stopCore) {
      try { var p = coreSession.bridge.stopCore({}); if (p && p.catch) p.catch(function () {}); } catch (e) { /* 忽略 */ }
    }
    coreSession = null;
  }
  function apiDelay(session, node) {
    var url = session.apiBase + '/proxies/' + encodeURIComponent(Core.buildNodeName(node)) + '/delay?timeout=6000&url=' + encodeURIComponent(testUrl());
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('dead');
      return r.json();
    }).then(function (d) {
      if (!d || typeof d.delay !== 'number') throw new Error('dead');
      return d.delay;
    });
  }
  function apiSelect(session, node) {
    return fetch(session.apiBase + '/proxies/' + Core.TEST_GROUP, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: Core.buildNodeName(node) })
    });
  }
  function fetchCountry(session) {
    return session.bridge.fetchViaProxy({ port: session.mixedPort, url: 'https://www.cloudflare.com/cdn-cgi/trace' }).then(function (r) {
      var loc = Core.parseTraceLoc(r && r.text);
      return loc ? Core.countryByCode(loc) : null;
    }).catch(function () { return null; });
  }
  function testNodeWith(session, node) {
    return apiDelay(session, node).then(function (delay) {
      node.test = { ok: true, delay: delay, at: Date.now() };
      return apiSelect(session, node).then(function () { return fetchCountry(session); }).then(function (c) {
        if (c) node.test.country = (c.flag ? c.flag + ' ' : '') + c.loc;
        return node.test;
      });
    }, function () {
      node.test = { ok: false, at: Date.now() };
      return node.test;
    });
  }
  function testOne(node) {
    if (testRunning) return;
    if (!nativeBridge()) { toast(t('网页版无法测速，请使用 Windows / macOS / Android 版（内置 mihomo 内核）'), false); return; }
    testRunning = true; testingIds[node.id] = true; renderNodes();
    startCoreFor(state.nodes).then(function (session) {
      return testNodeWith(session, node);
    }).then(function () {
      if (node.test && node.test.ok) toast(t('测速完成：{0}ms', node.test.delay), true);
      else toast(t('该节点不通'), false);
    }).catch(function () {
      toast(t('测速失败：内核启动失败'), false);
    }).then(function () {
      stopCore(); testRunning = false; delete testingIds[node.id]; save(); renderNodes();
    });
  }
  function testAll() {
    if (testRunning) return;
    if (!nativeBridge()) { toast(t('网页版无法测速，请使用 Windows / macOS / Android 版（内置 mihomo 内核）'), false); return; }
    var list = filteredNodeList();
    if (!list.length) { toast(t('没有可测速的节点'), false); return; }
    testRunning = true;
    list.forEach(function (n) { testingIds[n.id] = true; });
    renderNodes();
    var status = $('test-status');
    var done = 0;
    function progress() { if (status) status.textContent = t('测速中 {0}/{1}', done, list.length); }
    progress();
    var aliveCount = 0;
    startCoreFor(state.nodes).then(function (session) {
      var queue = list.slice();
      function worker() {
        var n = queue.shift();
        if (!n) return Promise.resolve();
        return apiDelay(session, n).then(function (delay) {
          n.test = { ok: true, delay: delay, at: Date.now() };
        }, function () {
          n.test = { ok: false, at: Date.now() };
        }).then(function () {
          done++; progress();
          delete testingIds[n.id]; renderNodes();
          return worker();
        });
      }
      var workers = [];
      for (var i = 0; i < Math.min(6, list.length); i++) workers.push(worker());
      return Promise.all(workers).then(function () { return session; });
    }).then(function (session) {
      var aliveNodes = list.filter(function (n) { return n.test && n.test.ok; });
      aliveCount = aliveNodes.length;
      var chain = Promise.resolve();
      aliveNodes.forEach(function (n) {
        chain = chain.then(function () {
          return apiSelect(session, n).then(function () { return fetchCountry(session); }).then(function (c) {
            if (c) { n.test.country = (c.flag ? c.flag + ' ' : '') + c.loc; renderNodes(); }
          });
        });
      });
      return chain;
    }).then(function () {
      var dead = list.filter(function (n) { return n.test && !n.test.ok; }).length;
      toast(t('测速完成：可用 {0} · 不通 {1}', aliveCount, dead), true);
    }).catch(function () {
      toast(t('测速失败：内核启动失败'), false);
    }).then(function () {
      stopCore(); testRunning = false; testingIds = {};
      if (status) status.textContent = '';
      save(); renderNodes();
    });
  }
  function deleteDead() {
    var dead = state.nodes.filter(function (n) { return n.test && !n.test.ok; });
    if (!dead.length) return;
    if (!confirm(t('删除 {0} 个不通节点？', dead.length))) return;
    var ids = {};
    dead.forEach(function (n) { ids[n.id] = true; });
    state.nodes = state.nodes.filter(function (n) { return !ids[n.id]; });
    save(); renderAll();
    toast(t('已删除 {0} 个不通节点', dead.length), true);
  }

  // ---------------------------------------------------------------- 分组
  var openPolicy = {};
  function renderGroups() {
    $('policy-list').innerHTML = Core.POLICY_GROUPS.map(function (pg) {
      var members = Core.policyGroupMembers(state, pg.name);
      var open = !!openPolicy[pg.name];
      return '<div class="card"><div class="card-head"><strong>' + esc(pg.name) + '</strong><span>' + esc(t('{0} 个节点', members.length)) + '</span></div>' +
        '<div class="row"><button data-pact="view" data-name="' + esc(pg.name) + '">' + (open ? '收起' : '查看节点') + '</button></div>' +
        (open ? '<div class="member-list">' + (members.length ? members.map(function (n) { return '<div class="member-item">' + esc(Core.buildNodeName(n)) + '</div>'; }).join('') : '<div class="hint">暂无节点</div>') + '</div>' : '') +
        '</div>';
    }).join('');
    var groups = Core.listGroups(state).filter(function (g) { return g.custom; });
    $('group-empty').style.display = groups.length ? 'none' : 'block';
    $('group-list').innerHTML = groups.map(function (g) {
      var targets = Core.listGroups(state).filter(function (x) { return x.name !== g.name; }).map(function (x) {
        return '<option value="' + esc(x.name) + '">' + esc(x.name) + '</option>';
      }).join('');
      return '<div class="card"><div class="card-head"><strong>' + esc(g.name) + '</strong><span>' + esc(t('{0} 个节点', g.count)) + '</span></div>' +
        '<div class="row" data-view="btns">' +
        '<button data-gact="rename" data-name="' + esc(g.name) + '">重命名</button>' +
        (g.count > 0 ? '<button data-gact="move" data-name="' + esc(g.name) + '">移动节点</button>' : '') +
        '<button data-gact="del" data-name="' + esc(g.name) + '" class="danger">删除</button>' +
        '</div>' +
        '<div class="row" data-view="edit" style="display:none">' +
        '<input type="text" data-field="rename" value="' + esc(g.name) + '">' +
        '<button data-gact="save-rename" data-name="' + esc(g.name) + '">保存</button>' +
        '<button data-gact="cancel" data-name="' + esc(g.name) + '">取消</button>' +
        '</div>' +
        '<div class="row" data-view="move" style="display:none">' +
        '<label>移动到分组：<select data-field="move-target">' + targets + '</select></label>' +
        '<button data-gact="save-move" data-name="' + esc(g.name) + '" class="primary">确认移动</button>' +
        '<button data-gact="cancel" data-name="' + esc(g.name) + '">取消</button>' +
        '</div></div>';
    }).join('');
    renderGroupSelect();
  }
  function cssId(name) { return 'g' + Array.prototype.map.call(name, function (c) { return c.charCodeAt(0).toString(36); }).join(''); }
  // 分组选择：真下拉框，列出全部分组；选「＋ 新建分组…」后出现输入框
  function groupNames() { return Core.listGroups(state).map(function (g) { return g.name; }); }
  function getGroupValue() {
    var sel = $('f-group-select');
    if (!sel) return '';
    if (sel.value === '__new__') return $('f-group-new').value.trim();
    return sel.value || '';
  }
  function setGroupValue(name) {
    var names = groupNames();
    var sel = $('f-group-select');
    var input = $('f-group-new');
    if (name && names.indexOf(name) !== -1) {
      sel.value = name; input.style.display = 'none';
    } else if (name) {
      sel.value = '__new__'; input.style.display = ''; input.value = name;
    } else {
      sel.value = names.indexOf(Core.ALL_GROUP) !== -1 ? Core.ALL_GROUP : (names[0] || '__new__');
      input.style.display = sel.value === '__new__' ? '' : 'none';
      if (sel.value !== '__new__') input.value = '';
    }
  }
  function renderGroupSelect() {
    var cur = getGroupValue();
    var names = groupNames();
    $('f-group-select').innerHTML = names.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
    }).join('') + '<option value="__new__">＋ 新建分组…</option>';
    setGroupValue(cur || Core.ALL_GROUP);
  }

  // ---------------------------------------------------------------- 订阅
  function renderSubs() {
    $('sub-empty').style.display = state.subscriptions.length ? 'none' : 'block';
    $('sub-list').innerHTML = state.subscriptions.map(function (s) {
      var shown = revealSubs[s.id] ? s.url : Core.maskUrl(s.url);
      return '<div class="card"><div class="card-head"><strong>' + esc(s.name) + '</strong></div>' +
        '<div class="url-line">' + esc(shown) + '</div>' +
        '<div class="row">' +
        '<button data-sact="toggle" data-id="' + s.id + '">' + (revealSubs[s.id] ? '隐藏' : '显示') + '</button>' +
        '<button data-sact="rename" data-id="' + s.id + '">改名</button>' +
        '<button data-sact="url" data-id="' + s.id + '">换链接</button>' +
        '<button data-sact="del" data-id="' + s.id + '" class="danger">删除</button>' +
        '</div>' +
        '<div class="row sub-edit" data-edit="rename" style="display:none">' +
        '<input type="text" data-field="name" value="' + esc(s.name) + '">' +
        '<button data-sact="save-name" data-id="' + s.id + '">保存</button>' +
        '<button data-sact="cancel" data-id="' + s.id + '">取消</button>' +
        '</div>' +
        '<div class="row sub-edit" data-edit="url" style="display:none">' +
        '<input type="text" data-field="url" value="' + esc(s.url) + '">' +
        '<button data-sact="save-url" data-id="' + s.id + '">保存</button>' +
        '<button data-sact="cancel" data-id="' + s.id + '">取消</button>' +
        '</div></div>';
    }).join('');
  }

  // ------------------------------------------------------------ 分流规则页
  function ruleText(r) {
    if (r.type === 'MATCH') return 'MATCH';
    return r.type + ',' + r.payload + (r.noResolve ? ' · no-resolve' : '');
  }
  function renderRules() {
    var targets = Core.ruleTargets(state);
    var box = $('rule-list');
    box.innerHTML = state.rules.map(function (r, i) {
      var opts = targets.map(function (tg) {
        return '<option value="' + esc(tg) + '"' + (tg === r.target ? ' selected' : '') + '>' + esc(tg) + '</option>';
      }).join('');
      var nameInput = r.builtin ? '' :
        '<input class="rule-name-input" data-idx="' + i + '" value="' + esc(r.name || '') + '" placeholder="' + esc(t('规则名称（可选）')) + '">';
      var targetHtml = r.builtin
        ? '<span class="rule-target-text">' + esc(r.target) + '</span>'
        : '<select class="rule-target-sel" data-idx="' + i + '">' + opts + '</select>';
      var acts = r.builtin
        ? '<span class="rule-badge">' + esc(t('默认')) + '</span>'
        : '<button data-ract="up" data-idx="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button data-ract="down" data-idx="' + i + '"' + (i === state.rules.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button data-ract="del" data-idx="' + i + '">' + esc(t('删除')) + '</button>';
      return '<div class="rule-row">' + nameInput + '<span class="rule-text">' + esc(ruleText(r)) + '</span>' +
        targetHtml + acts + '</div>';
    }).join('');
    $('rule-provider').innerHTML = Core.RULE_PROVIDERS.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    var cur = $('rule-target').value;
    $('rule-target').innerHTML = targets.map(function (tg) { return '<option value="' + esc(tg) + '">' + esc(tg) + '</option>'; }).join('');
    if (cur && targets.indexOf(cur) !== -1) $('rule-target').value = cur;
    applyI18n(box);
  }
  function syncRuleType() {
    var ty = $('rule-type').value;
    $('rule-provider-row').style.display = ty === 'RULE-SET' ? '' : 'none';
    $('rule-payload-row').style.display = (ty === 'RULE-SET' || ty === 'MATCH') ? 'none' : '';
  }

  function renderAll() { renderNodes(); renderGroups(); renderSubs(); renderRules(); renderYaml(); applyI18n(); }
  function renderYaml() { $('yaml-out').value = Core.generateFullYaml(state); }

  // ---------------------------------------------------------------- 添加/编辑节点
  function collectNodeFromForm() {
    var details = {};
    var uuid = $('f-uuid').value.trim();
    var password = $('f-password').value.trim();
    if (uuid) details.uuid = uuid;
    if (password) details.password = password;
    var method = $('f-method').value.trim();
    if (method) { details.method = method; details.cipher = method; }
    var network = $('f-network').value;
    if (network) details.network = network;
    if ($('f-tls').checked) details.tls = true;
    var servername = $('f-servername').value.trim();
    if (servername) { details.servername = servername; details.sni = servername; }
    var flow = $('f-flow').value.trim();
    if (flow) details.flow = flow;
    var fp = $('f-fp').value.trim();
    if (fp) details.clientFingerprint = fp;
    var pbk = $('f-pbk').value.trim();
    if (pbk) details.realityPublicKey = pbk;
    var sid = $('f-sid').value.trim();
    if (sid) details.realityShortId = sid;
    var alpn = $('f-alpn').value.trim();
    if (alpn) details.alpn = alpn.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if ($('f-skip').checked) details.skipCertVerify = true;
    var thost = $('f-thost').value.trim();
    if (thost) details.transportHost = thost;
    var tpath = $('f-tpath').value.trim();
    if (tpath) details.transportPath = tpath;
    var tmode = $('f-tmode').value.trim();
    if (tmode) details.transportMode = tmode;
    return {
      id: editingNodeId || undefined,
      groupName: getGroupValue(),
      location: $('f-location').value.trim(),
      server: $('f-server').value.trim(),
      port: parseInt($('f-port').value, 10),
      type: $('f-type').value,
      suffix: $('f-suffix').value.trim() || undefined,
      details: details
    };
  }

  function fillForm(n) {
    var d = n.details || {};
    setGroupValue(n.groupName || Core.ALL_GROUP);
    $('f-location').value = n.location || '';
    $('f-server').value = n.server || '';
    $('f-port').value = n.port || '';
    $('f-type').value = n.type || 'vless';
    $('f-suffix').value = n.suffix || '';
    $('f-uuid').value = d.uuid || '';
    $('f-password').value = d.password || '';
    $('f-method').value = d.method || d.cipher || '';
    $('f-network').value = d.network || 'tcp';
    $('f-tls').checked = !!d.tls;
    $('f-servername').value = d.servername || d.sni || '';
    $('f-flow').value = d.flow || '';
    $('f-fp').value = d.clientFingerprint || '';
    $('f-pbk').value = d.realityPublicKey || '';
    $('f-sid').value = d.realityShortId || '';
    $('f-alpn').value = (d.alpn || []).join(',');
    $('f-skip').checked = !!d.skipCertVerify;
    $('f-thost').value = d.transportHost || '';
    $('f-tpath').value = d.transportPath || '';
    $('f-tmode').value = d.transportMode || '';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return; }
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  // 把候选节点批量写入（批量粘贴链接 / 导入订阅内容共用）
  function importCandidates(cands, parseErrs, out) {
    var added = 0, skipped = (parseErrs || []).slice();
    cands.forEach(function (c) {
      var res = Core.addNode(state, { groupName: c.groupName || Core.ALL_GROUP, location: c.location || t('未知'), type: c.type, server: c.server, port: c.port, details: c.details });
      if (res.ok) added++; else skipped.push(res.error);
    });
    save(); renderAll();
    var m = t('导入完成：成功 {0} 条', added);
    if (skipped.length) m += t('，跳过 {0} 条（{1}）', skipped.length, skipped[0]);
    msg(out, m, added > 0);
  }
  function onParse() {
    var text = $('link-input').value.trim();
    var out = $('parse-msg');
    if (!text) { msg(out, '请先粘贴分享链接', false); return; }
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var first = lines[0] || '';
    // 链接被复制时折行成多行（后续行不含 ://）时，拼回完整链接再解析
    if (lines.length > 1 && first.indexOf('://') !== -1 && lines.slice(1).join('').indexOf('://') === -1) first = lines.join('');
    // 多条链接（一行一条）→ 批量直接导入
    var linkLines = lines.filter(function (l) { return l.indexOf('://') !== -1; });
    if (linkLines.length >= 2) {
      var bgroup = getGroupValue() || Core.ALL_GROUP;
      var bcands = [], berrs = [];
      linkLines.forEach(function (line) {
        var p = Core.parseShareLink(line);
        if (!p.ok) { berrs.push(p.error); return; }
        bcands.push({ type: p.type, server: p.server, port: p.port, details: p.details, groupName: bgroup, location: p.suggestedLocation || '' });
      });
      if (!bcands.length) { msg(out, berrs[0] || t('没有解析到任何节点'), false); return; }
      $('link-input').value = '';
      importCandidates(bcands, berrs, out);
      return;
    }
    var r = Core.parseShareLink(first);
    if (!r.ok) { msg(out, r.error, false); return; }
    fillForm({ groupName: Core.ALL_GROUP, location: r.suggestedLocation || '', server: r.server, port: r.port, type: r.type, details: r.details });
    msg(out, t('已解析：{0} / {1}:{2}。{3} 已默认放入「全部节点」分组，请确认后保存。', r.type, r.server, r.port, r.locationNote || ''), true);
  }

  function onSaveNode() {
    var out = $('parse-msg');
    var node = collectNodeFromForm();
    if (!node.groupName) { msg(out, '请填分组名（可先到「分组」页新建，或直接输入新分组名）', false); return; }
    if (node.groupName.indexOf('|') !== -1) { msg(out, '分组名不能包含「|」', false); return; }
    if (!node.location) { msg(out, '请填地点名（建议用国家/地区名，如 日本、美国）', false); return; }
    if (!node.server || !node.port) { msg(out, '请填服务器地址和端口', false); return; }
    if (editingNodeId) {
      var idx = state.nodes.findIndex(function (n) { return n.id === editingNodeId; });
      if (idx === -1) { msg(out, '要编辑的节点不存在', false); return; }
      var others = state.nodes.filter(function (n) { return n.id !== editingNodeId; });
      var dup = others.some(function (n) { return Core.buildNodeName(n) === Core.buildNodeName(node); });
      if (dup) { msg(out, t('节点名重复：{0}', Core.buildNodeName(node)), false); return; }
      node.id = editingNodeId;
      state.nodes[idx] = node;
      if (state.groups.indexOf(node.groupName) === -1) state.groups.push(node.groupName);
      editingNodeId = null;
      $('save-node-btn').textContent = t('保存节点');
      msg(out, t('已更新节点：{0}', Core.buildNodeName(node)), true);
    } else {
      var res = Core.addNode(state, node);
      if (!res.ok) { msg(out, res.error, false); return; }
      msg(out, t('已添加节点：{0}', res.node.name), true);
    }
    save(); renderAll();
  }

  // ---------------------------------------------------------------- 事件绑定
  function bind() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.remove('active'); });
        document.body.classList.remove('settings-open');
        $('settings-btn').classList.remove('active');
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'export') renderYaml();
      });
    });
    // 右上角「设置」按钮：打开设置页（关于内容在设置页里）
    $('settings-back').addEventListener('click', function () {
      document.body.classList.remove('settings-open');
      document.querySelector('[data-tab="nodes"]').click();
    });
    $('settings-btn').addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.remove('active'); });
      document.body.classList.add('settings-open');
      $('settings-btn').classList.add('active');
      $('tab-about').classList.add('active');
      if ($('set-test-url')) $('set-test-url').value = testUrl();
    });

    $('rule-list').addEventListener('change', function (e) {
      var sel = e.target.closest('.rule-target-sel');
      if (sel) { state.rules[Number(sel.dataset.idx)].target = sel.value; save(); return; }
      var ni = e.target.closest('.rule-name-input');
      if (ni) { state.rules[Number(ni.dataset.idx)].name = ni.value.trim(); save(); }
    });
    $('rule-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var i = Number(btn.dataset.idx);
      if (btn.dataset.ract === 'del') state.rules.splice(i, 1);
      else if (btn.dataset.ract === 'up' && i > 0) { var t1 = state.rules[i - 1]; state.rules[i - 1] = state.rules[i]; state.rules[i] = t1; }
      else if (btn.dataset.ract === 'down' && i < state.rules.length - 1) { var t2 = state.rules[i + 1]; state.rules[i + 1] = state.rules[i]; state.rules[i] = t2; }
      else return;
      save(); renderRules(); applyI18n();
    });
    $('rule-type').addEventListener('change', syncRuleType);
    $('add-rule-btn').addEventListener('click', function () {
      var ty = $('rule-type').value;
      var payload = ty === 'RULE-SET' ? $('rule-provider').value : $('rule-payload').value.trim();
      if (ty !== 'MATCH' && !payload) { msg($('rule-msg'), t('请输入规则值'), false); return; }
      state.rules.push({ type: ty, payload: ty === 'MATCH' ? '' : payload, target: $('rule-target').value, noResolve: $('rule-noresolve').checked && ty !== 'MATCH', builtin: false, name: $('rule-name').value.trim() });
      $('rule-payload').value = '';
      $('rule-name').value = '';
      save(); renderRules(); applyI18n();
      msg($('rule-msg'), t('规则已添加'), true);
    });
    $('reset-rules-btn').addEventListener('click', function () {
      if (!window.confirm(t('确定要恢复默认分流规则吗？'))) return;
      state.rules = Core.defaultRules();
      save(); renderRules(); applyI18n();
      msg($('rule-msg'), t('已恢复默认规则'), true);
    });
    $('node-search').addEventListener('input', renderNodes);
    $('test-all-btn').addEventListener('click', testAll);
    $('del-dead-btn').addEventListener('click', deleteDead);
    $('node-group-filter').addEventListener('change', renderNodes);
    $('node-type-filter').addEventListener('change', renderNodes);
    $('node-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var id = btn.dataset.id;
      var node = state.nodes.find(function (n) { return n.id === id; });
      if (!node) return;
      if (btn.dataset.act === 'link') {
        copyText(Core.buildShareLink(node));
        var oldTxt = btn.textContent; btn.textContent = t('已复制');
        setTimeout(function () { btn.textContent = oldTxt; }, 1200);
        return;
      }
      if (btn.dataset.act === 'test') { testOne(node); return; }
      if (btn.dataset.act === 'del') {
        if (confirm(t('删除节点 {0}？', Core.buildNodeName(node)))) {
          state.nodes = state.nodes.filter(function (n) { return n.id !== id; });
          save(); renderAll();
        }
      } else if (btn.dataset.act === 'edit') {
        editingNodeId = id;
        fillForm(node);
        $('save-node-btn').textContent = t('保存修改');
        document.querySelector('[data-tab="add"]').click();
      }
    });

    $('parse-btn').addEventListener('click', onParse);
    $('save-node-btn').addEventListener('click', onSaveNode);
    $('clear-form-btn').addEventListener('click', function () {
      editingNodeId = null;
      $('save-node-btn').textContent = t('保存节点');
      fillForm({ details: {} });
    });

    $('f-group-select').addEventListener('change', function () {
      $('f-group-new').style.display = this.value === '__new__' ? '' : 'none';
      if (this.value === '__new__') $('f-group-new').focus();
    });

    $('add-group-btn').addEventListener('click', function () {
      var res = Core.addGroup(state, $('new-group-name').value);
      var out = $('group-msg');
      if (!res.ok) { msg(out, res.error, false); return; }
      $('new-group-name').value = '';
      msg(out, '分组已创建', true);
      save(); renderAll();
    });
    $('policy-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var name = btn.dataset.name;
      openPolicy[name] = !openPolicy[name];
      renderGroups(); applyI18n();
    });
    $('group-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var name = btn.dataset.name;
      var out = $('group-msg');
      var card = btn.closest('.card');
      if (btn.dataset.gact === 'rename') {
        // 点重命名后才出现编辑框，且预填当前分组名
        card.querySelector('[data-view="btns"]').style.display = 'none';
        var mv0 = card.querySelector('[data-view="move"]'); if (mv0) mv0.style.display = 'none';
        var ed = card.querySelector('[data-view="edit"]');
        ed.style.display = '';
        var inp = ed.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      if (btn.dataset.gact === 'move') {
        card.querySelector('[data-view="btns"]').style.display = 'none';
        var ed0 = card.querySelector('[data-view="edit"]'); if (ed0) ed0.style.display = 'none';
        var mv = card.querySelector('[data-view="move"]');
        if (mv) mv.style.display = '';
        return;
      }
      if (btn.dataset.gact === 'cancel') { renderGroups(); applyI18n(); return; }
      if (btn.dataset.gact === 'save-rename') {
        var input = card.querySelector('[data-field="rename"]');
        var res = Core.renameGroup(state, name, input ? input.value : '');
        if (!res.ok) { msg(out, res.error, false); return; }
        msg(out, t('已改名，同步更新了 {0} 个节点', res.updatedNodes), true);
      } else if (btn.dataset.gact === 'save-move') {
        var sel = card.querySelector('[data-field="move-target"]');
        var target = sel ? sel.value : '';
        var res3 = Core.moveGroupNodes(state, name, target);
        if (!res3.ok) { msg(out, res3.error, false); return; }
        var m3 = t('已移动 {0} 个节点到「{1}」', res3.moved, target);
        if (res3.skipped) m3 += t('，{0} 个因重名留在原分组', res3.skipped);
        msg(out, m3, true);
      } else if (btn.dataset.gact === 'del') {
        var r2 = Core.deleteGroup(state, name);
        if (!r2.ok) { msg(out, r2.error, false); return; }
        msg(out, '分组已删除', true);
      }
      save(); renderAll();
    });

    $('add-sub-btn').addEventListener('click', function () {
      var res = Core.addSubscription(state, $('sub-name').value, $('sub-url').value);
      var out = $('sub-msg');
      if (!res.ok) { msg(out, res.error, false); return; }
      $('sub-name').value = ''; $('sub-url').value = '';
      msg(out, t('已添加订阅：{0}', res.sub.name), true);
      save(); renderAll();
    });
    $('sub-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var sub = state.subscriptions.find(function (s) { return s.id === btn.dataset.id; });
      if (!sub) return;
      var out = $('sub-msg');
      if (btn.dataset.sact === 'toggle') { revealSubs[sub.id] = !revealSubs[sub.id]; renderSubs(); applyI18n(); return; }
      var card = btn.closest('.card');
      if (btn.dataset.sact === 'rename' || btn.dataset.sact === 'url') {
        // 不用系统 prompt（在桌面端/部分浏览器里不弹出），改成卡片内编辑
        card.querySelectorAll('.sub-edit').forEach(function (el) { el.style.display = 'none'; });
        var ed = card.querySelector('[data-edit="' + btn.dataset.sact + '"]');
        if (ed) { ed.style.display = ''; var inp = ed.querySelector('input'); if (inp) { inp.focus(); inp.select(); } }
        return;
      }
      if (btn.dataset.sact === 'cancel') { renderSubs(); applyI18n(); return; }
      if (btn.dataset.sact === 'save-name') {
        var nn = card.querySelector('[data-field="name"]').value.trim();
        if (!nn) { msg(out, '订阅名不能为空', false); return; }
        if (state.subscriptions.some(function (s) { return s.id !== sub.id && s.name === nn; })) { msg(out, '订阅名已存在', false); return; }
        sub.name = nn;
      } else if (btn.dataset.sact === 'save-url') {
        var nu = card.querySelector('[data-field="url"]').value.trim();
        if (!/^https?:\/\/\S+$/i.test(nu)) { msg(out, '不是有效的 http(s) 链接', false); return; }
        if (state.subscriptions.some(function (s) { return s.id !== sub.id && s.url === nu; })) { msg(out, '该链接已经存在', false); return; }
        sub.url = nu;
      } else if (btn.dataset.sact === 'del') {
        if (confirm(t('删除订阅「{0}」？', sub.name))) { state.subscriptions = state.subscriptions.filter(function (s) { return s.id !== sub.id; }); }
        else return;
      } else return;
      save(); renderAll();
    });

    function allLinks() { return state.nodes.map(function (n) { return Core.buildShareLink(n); }); }
    $('copy-links-btn').addEventListener('click', function () {
      if (!state.nodes.length) { msg($('export-msg'), '还没有节点可导出', false); return; }
      copyText(allLinks().join('\n'));
      msg($('export-msg'), t('全部 {0} 个节点的链接已复制', state.nodes.length), true);
    });
    $('download-links-btn').addEventListener('click', function () {
      if (!state.nodes.length) { msg($('export-msg'), '还没有节点可导出', false); return; }
      download('node-links.txt', allLinks().join('\n'), 'text/plain');
      msg($('export-msg'), '已生成链接清单', true);
    });
    // 把订阅内容（base64 / 链接列表 / Clash YAML）解析成候选节点
    function buildCandidates(text, target) {
      var res = Core.decodeSubContent(text);
      var cands = [], errs = [];
      if (res.yaml) {
        Core.parseClashProxies(res.yaml).forEach(function (it) {
          var parts = it.rawName.split('|');
          var g = target, loc = '';
          if (parts.length >= 4 && parts[2] === it.server && Number(parts[3]) === it.port) { g = parts[0]; loc = parts[1]; }
          else { var det = Core.detectCountry({ remark: it.rawName, server: it.server }); loc = det && det.loc ? det.loc : ''; }
          cands.push({ type: it.type, server: it.server, port: it.port, details: it.details, groupName: g, location: loc });
        });
      } else {
        res.links.forEach(function (line) {
          var p = Core.parseShareLink(line);
          if (!p.ok) { errs.push(p.error); return; }
          cands.push({ type: p.type, server: p.server, port: p.port, details: p.details, groupName: target, location: p.suggestedLocation || '' });
        });
      }
      return { cands: cands, errs: errs };
    }
    $('import-content-btn').addEventListener('click', function () {
      var out = $('sub-msg');
      var text = $('sub-content').value;
      if (!text.trim()) { msg(out, '请先粘贴要导入的内容', false); return; }
      var target = $('sub-content-group').value.trim() || Core.ALL_GROUP;
      var built = buildCandidates(text, target);
      if (!built.cands.length) { msg(out, t('没有从内容里解析出任何节点'), false); return; }
      $('sub-content').value = '';
      importCandidates(built.cands, built.errs, out);
    });
    // ------------------------------------------------ 解析订阅：拉取链接 → 勾选 → 添加
    var subCandidates = [];
    function renderSubCandidates() {
      var box = $('sub-candidates');
      if (!subCandidates.length) { box.innerHTML = ''; return; }
      var rows = subCandidates.map(function (c, i) {
        var nm = Core.buildNodeName({ groupName: c.groupName || Core.ALL_GROUP, location: c.location || t('未知'), server: c.server, port: c.port });
        return '<label class="cand-row"><input type="checkbox" data-ci="' + i + '" checked><span class="cand-name">' + esc(nm) + '</span><span class="rule-badge">' + esc(c.type) + '</span></label>';
      }).join('');
      box.innerHTML = '<div class="card"><div class="card-head"><strong>' + esc(t('解析结果')) + '</strong><span id="cand-count"></span></div>' +
        '<div class="row"><button id="cand-all-btn">全选</button><button id="cand-none-btn">全不选</button><button id="cand-add-btn" class="primary">添加选中节点</button></div>' +
        '<div class="cand-list">' + rows + '</div></div>';
      updateCandCount();
    }
    function updateCandCount() {
      var el = $('cand-count'); if (!el) return;
      var n = 0;
      $('sub-candidates').querySelectorAll('input[type="checkbox"][data-ci]').forEach(function (b) { if (b.checked) n++; });
      el.textContent = t('共 {0} 个节点，已选 {1} 个', subCandidates.length, n);
    }
    $('sub-candidates').addEventListener('change', function (e) {
      if (e.target.matches('input[type="checkbox"][data-ci]')) updateCandCount();
    });
    $('sub-candidates').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var boxes = $('sub-candidates').querySelectorAll('input[type="checkbox"][data-ci]');
      if (btn.id === 'cand-all-btn') { boxes.forEach(function (b) { b.checked = true; }); updateCandCount(); return; }
      if (btn.id === 'cand-none-btn') { boxes.forEach(function (b) { b.checked = false; }); updateCandCount(); return; }
      if (btn.id === 'cand-add-btn') {
        var picked = [];
        boxes.forEach(function (b) { if (b.checked) picked.push(subCandidates[Number(b.dataset.ci)]); });
        if (!picked.length) { msg($('sub-msg'), t('请先勾选要添加的节点'), false); return; }
        subCandidates = [];
        renderSubCandidates();
        importCandidates(picked, [], $('sub-msg'));
      }
    });
    function fetchSubscription(url) {
      var headers = { 'User-Agent': 'clash.meta' };
      if (window.nativeFetch) return window.nativeFetch(url, headers);
      return fetch(url, { headers: headers }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    }
    $('parse-sub-btn').addEventListener('click', function () {
      var out = $('sub-msg');
      var text = $('sub-content').value;
      if (!text.trim()) { msg(out, '请先粘贴要导入的内容', false); return; }
      var target = $('sub-content-group').value.trim() || Core.ALL_GROUP;
      function useContent(content) {
        var built = buildCandidates(content, target);
        if (!built.cands.length) { msg(out, t('没有从内容里解析出任何节点'), false); return; }
        subCandidates = built.cands;
        renderSubCandidates(); applyI18n($('sub-candidates'));
        msg(out, t('已解析出 {0} 个节点，请勾选要添加的', built.cands.length), true);
      }
      // 整框就是一个订阅链接（可能被折行）时直接拉取；否则按粘贴的内容解析
      var compact = text.replace(/\s+/g, '');
      var url = null;
      if (/^https?:\/\/\S+$/.test(compact)) url = compact;
      else { var m = text.match(/https?:\/\/\S+/i); if (m) url = m[0]; }
      if (!url) { useContent(text); return; }
      msg(out, t('正在拉取订阅内容…'), true);
      fetchSubscription(url).then(useContent).catch(function (e) {
        msg(out, t('拉取订阅失败：{0}（也可以把订阅内容直接粘贴到上方框里导入）', (e && e.message) || 'network error'), false);
      });
    });
    $('copy-yaml-btn').addEventListener('click', function () {
      renderYaml();
      var text = $('yaml-out').value;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      else { $('yaml-out').select(); document.execCommand('copy'); }
      msg($('export-msg'), '完整 YAML 已复制', true);
    });
    $('download-yaml-btn').addEventListener('click', function () {
      renderYaml();
      download('config.yaml', $('yaml-out').value, 'text/yaml');
    });
    $('export-json-btn').addEventListener('click', function () {
      download('node-yml-config-backup.json', JSON.stringify(state, null, 2), 'application/json');
    });
    $('import-json-input').addEventListener('change', function () {
      var file = this.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var s = JSON.parse(reader.result);
          if (!s || !Array.isArray(s.nodes) || !Array.isArray(s.groups) || !Array.isArray(s.subscriptions)) throw new Error(t('格式不对'));
          state = migrateState(s); save(); renderAll();
          msg($('export-msg'), '备份已导入', true);
        } catch (err) { msg($('export-msg'), t('导入失败：{0}', err.message), false); }
      };
      reader.readAsText(file);
      this.value = '';
    });

    // 语言设置：填充语言下拉并绑定切换（立即生效并记住选择）
    if (window.I18N_LANGS && $('lang-select')) {
      var sel = $('lang-select');
      sel.innerHTML = window.I18N_LANGS.map(function (l) {
        return '<option value="' + l.code + '">' + l.name + '</option>';
      }).join('');
      sel.value = window.i18nGetLang ? window.i18nGetLang() : 'zh-CN';
      sel.setAttribute('data-no-i18n', '');
      sel.addEventListener('change', function () {
        if (window.i18nSetLang) window.i18nSetLang(sel.value);
        renderAll();
      });
    }

    // 测速设置：测速链接可改（测延迟时内核访问的地址），保存到 state.settings.testUrl
    if ($('set-test-url')) {
      $('set-test-url-save').addEventListener('click', function () {
        var v = $('set-test-url').value.trim();
        if (!/^https?:\/\//i.test(v)) { toast(t('测速链接格式不对'), false); return; }
        if (!state.settings) state.settings = {};
        state.settings.testUrl = v; save();
        toast(t('已保存'), true);
      });
      $('set-test-url-reset').addEventListener('click', function () {
        if (!state.settings) state.settings = {};
        state.settings.testUrl = Core.DEFAULT_TEST_URL;
        $('set-test-url').value = Core.DEFAULT_TEST_URL; save();
        toast(t('已恢复默认测速链接'), true);
      });
    }

    $('check-update-btn').addEventListener('click', function () { checkForUpdates(true); });
    $('update-now-btn').addEventListener('click', function () { startInAppUpdate(); });
    $('update-later-btn').addEventListener('click', function () { $('update-modal').hidden = true; });
  }

  // ---------------------------------------------------------------- 更新检测
  var APP_VERSION = '1.0.16';
  var LATEST_API = 'https://api.github.com/repos/Vardven/node-yml-config-tool/releases/latest';
  var updateReleaseUrl = 'https://github.com/Vardven/node-yml-config-tool/releases/latest';
  var latestRelease = null;
  var updating = false;

  function isNewerVersion(latest, current) {
    var a = latest.split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var b = current.split('.').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
  }

  function checkForUpdates(manual) {
    var out = $('update-check-msg');
    if (manual && out) msg(out, '正在检查更新…', true);
    fetch(LATEST_API, { headers: { 'Accept': 'application/vnd.github+json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var latest = String(d.tag_name || '').replace(/^v/i, '');
        if (latest && isNewerVersion(latest, APP_VERSION)) {
          latestRelease = d;
          updateReleaseUrl = d.html_url || updateReleaseUrl;
          $('update-title').textContent = t('发现新版本 v{0}', latest);
          $('update-desc').textContent = t('当前版本 v{0}，最新版本 v{1}。点「立即更新」将直接在软件内下载并安装。', APP_VERSION, latest);
          $('update-modal').hidden = false;
          applyI18n($('update-modal'));
          if (manual && out) msg(out, t('发现新版本 v{0}', latest), true);
        } else if (manual && out) {
          msg(out, t('已是最新版本（v{0}）', APP_VERSION), true);
        }
      })
      .catch(function () {
        if (manual && out) msg(out, '检查更新失败，请检查网络后重试', false);
      });
  }

  // 软件内更新：优先在应用内下载安装包并调起系统安装程序；任何一步做不到才打开下载页。
  function startInAppUpdate() {
    if (updating) return;
    var assets = (latestRelease && latestRelease.assets) || [];
    function findAsset(pred) {
      for (var i = 0; i < assets.length; i++) { if (pred(assets[i].name)) return assets[i]; }
      return null;
    }
    function setDesc(s) { $('update-desc').textContent = s; }
    function fallback() {
      updating = false;
      $('update-now-btn').disabled = false;
      $('update-modal').hidden = true;
      toast(t('软件内更新失败，已打开下载页'), false);
      window.open(updateReleaseUrl, '_blank');
    }
    // 桌面版（Electron）：主进程下载安装包到临时目录并打开安装程序
    if (window.nativeUpdate && window.nativePlatform) {
      var pf = window.nativePlatform;
      var asset = null;
      if (pf.platform === 'win32') {
        asset = findAsset(function (n) { return n.slice(-(pf.arch + '-setup.exe').length) === pf.arch + '-setup.exe'; }) ||
          findAsset(function (n) { return n.slice(-(pf.arch + '-portable.exe').length) === pf.arch + '-portable.exe'; });
      } else if (pf.platform === 'darwin') {
        asset = findAsset(function (n) { return n.slice(-4) === '.dmg' && n.indexOf(pf.arch) !== -1; });
      }
      if (asset) {
        updating = true;
        $('update-now-btn').disabled = true;
        setDesc(t('正在下载更新…'));
        if (window.onUpdateProgress) window.onUpdateProgress(function (pct) {
          if (pct >= 0) setDesc(t('正在下载更新…{0}%', pct));
        });
        window.nativeUpdate(asset.browser_download_url, asset.name).then(function () {
          updating = false;
          $('update-now-btn').disabled = false;
          setDesc(t('下载完成，正在打开安装程序…'));
        }).catch(function () { fallback(); });
        return;
      }
    }
    // 安卓版：按 CPU 架构选对应的 APK，原生下载到缓存后调起系统安装器
    var cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins && cap.Plugins.AppTools && cap.Plugins.Filesystem) {
      updating = true;
      $('update-now-btn').disabled = true;
      setDesc(t('正在下载更新…'));
      cap.Plugins.AppTools.deviceInfo().then(function (info) {
        var abi = info && info.abis && info.abis[0];
        var apkName = abi === 'arm64-v8a' ? 'app-arm64-v8a-release.apk'
          : abi === 'armeabi-v7a' ? 'app-armeabi-v7a-release.apk'
          : abi === 'x86_64' ? 'app-x86_64-release.apk' : 'app-release.apk';
        var asset = findAsset(function (n) { return n === apkName; }) || findAsset(function (n) { return n === 'app-release.apk'; });
        if (!asset) throw new Error('noasset');
        return cap.Plugins.Filesystem.downloadFile({ url: asset.browser_download_url, path: 'update.apk', directory: 'CACHE' });
      }).then(function () {
        return cap.Plugins.AppTools.installApk({ path: 'update.apk' });
      }).then(function (res) {
        updating = false;
        $('update-now-btn').disabled = false;
        if (res && res.needsPermission) setDesc(t('需要允许「安装未知应用」：已打开系统设置，允许后请重新点「立即更新」'));
        else setDesc(t('已打开安装程序，请按系统提示完成更新'));
      }).catch(function () { fallback(); });
      return;
    }
    // 网页版或找不到对应安装包：打开下载页
    $('update-modal').hidden = true;
    window.open(updateReleaseUrl, '_blank');
  }

  function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }
  function download(filename, text, type) {
    // 安卓 App（Capacitor 的 WebView）不处理 blob 链接下载，点了没反应；
    // 原生环境优先走系统「另存为」对话框（SaveAs 插件 / SAF）：用户在文件管理器里自己选保存位置；
    // 没有该插件时退回 Filesystem 写缓存 + 系统分享面板。
    var cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins) {
      if (cap.Plugins.SaveAs) {
        var mime = type || (filename.slice(-5) === '.json' ? 'application/json' : (filename.slice(-4) === '.txt' ? 'text/plain' : 'text/yaml'));
        cap.Plugins.SaveAs.saveAs({ filename: filename, contentType: mime, data: b64utf8(text) })
          .then(function () {
            var em = $('export-msg');
            if (em) msg(em, t('文件已保存'), true);
          })
          .catch(function () {
            var em = $('export-msg');
            if (em) msg(em, t('已取消保存'), false);
          });
        return;
      }
      if (cap.Plugins.Filesystem && cap.Plugins.Share) {
        var fs = cap.Plugins.Filesystem;
        var share = cap.Plugins.Share;
        fs.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' })
          .then(function () { return fs.getUri({ path: filename, directory: 'CACHE' }); })
          .then(function (r) { return share.share({ title: filename, url: r.uri }); })
          .catch(function () {
            var em = $('export-msg');
            if (em) msg(em, '保存失败，请改用「复制 YAML」', false);
          });
        return;
      }
    }
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  save(); // 落盘一次，确保旧数据迁移（默认 -> 全部节点）立即生效
  bind();
  syncRuleType();
  renderAll();
  checkForUpdates(false);
})();
