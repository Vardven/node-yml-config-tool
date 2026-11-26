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
    if (!Array.isArray(s.rules)) s.rules = Core.defaultRules();
    // v1.0.7 及更早的规则没有 builtin 标记：按类型+值匹配默认规则补上（默认规则锁定顺序与删除）
    var defs = Core.defaultRules();
    var usedDef = {};
    s.rules.forEach(function (r) {
      if (r.builtin !== undefined) return;
      var key = r.type + '|' + (r.payload || '');
      var hit = -1;
      defs.forEach(function (d, ix) { if (hit === -1 && !usedDef[ix] && (d.type + '|' + (d.payload || '')) === key) hit = ix; });
      if (hit !== -1) { usedDef[hit] = true; r.builtin = true; } else { r.builtin = false; }
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
  }
  var t = window.t || function (s) { return s; };
  function applyI18n(root) { if (window.i18nApply) window.i18nApply(root || document.body); }

  // ---------------------------------------------------------------- 节点列表
  function renderNodes() {
    var q = $('node-search').value.trim().toLowerCase();
    var gf = $('node-group-filter').value;
    var tf = $('node-type-filter').value;
    var list = state.nodes.filter(function (n) {
      if (gf && n.groupName !== gf) return false;
      if (tf && n.type !== tf) return false;
      if (q && (Core.buildNodeName(n) + ' ' + n.server).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $('node-count').textContent = t('共 {0} 个节点', state.nodes.length) + (list.length !== state.nodes.length ? t('，筛选后 {0} 个', list.length) : '');
    $('node-empty').style.display = state.nodes.length ? 'none' : 'block';
    $('node-list').innerHTML = list.map(function (n) {
      var name = Core.buildNodeName(n);
      return '<div class="card">' +
        '<div class="card-head"><strong>' + esc(name) + '</strong><span class="badge">' + esc(n.type) + '</span></div>' +
        '<pre class="yaml">' + esc(Core.nodeYaml(n)) + '</pre>' +
        '<div class="row">' +
        '<button data-act="link" data-id="' + n.id + '">复制链接</button>' +
        '<button data-act="edit" data-id="' + n.id + '">编辑</button>' +
        '<button data-act="del" data-id="' + n.id + '" class="danger">删除</button>' +
        '</div></div>';
    }).join('');
    // 分组筛选下拉
    var cur = $('node-group-filter').value;
    $('node-group-filter').innerHTML = '<option value="">全部分组</option>' + Core.listGroups(state).map(function (g) {
      return '<option value="' + esc(g.name) + '"' + (g.name === cur ? ' selected' : '') + '>' + esc(g.name) + '</option>';
    }).join('');
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
      return '<div class="card"><div class="card-head"><strong>' + esc(g.name) + '</strong><span>' + esc(t('{0} 个节点', g.count)) + '</span></div>' +
        '<div class="row" data-view="btns">' +
        '<button data-gact="rename" data-name="' + esc(g.name) + '">重命名</button>' +
        '<button data-gact="del" data-name="' + esc(g.name) + '" class="danger">删除</button>' +
        '</div>' +
        '<div class="row" data-view="edit" style="display:none">' +
        '<input type="text" data-field="rename" value="' + esc(g.name) + '">' +
        '<button data-gact="save-rename" data-name="' + esc(g.name) + '">保存</button>' +
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
      var acts = r.builtin
        ? '<span class="rule-badge">' + esc(t('默认')) + '</span>'
        : '<button data-ract="up" data-idx="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button data-ract="down" data-idx="' + i + '"' + (i === state.rules.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button data-ract="del" data-idx="' + i + '">' + esc(t('删除')) + '</button>';
      return '<div class="rule-row">' + nameInput + '<span class="rule-text">' + esc(ruleText(r)) + '</span>' +
        '<select class="rule-target-sel" data-idx="' + i + '">' + opts + '</select>' + acts + '</div>';
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
        var ed = card.querySelector('[data-view="edit"]');
        ed.style.display = '';
        var inp = ed.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      if (btn.dataset.gact === 'cancel') { renderGroups(); applyI18n(); return; }
      if (btn.dataset.gact === 'save-rename') {
        var input = card.querySelector('[data-field="rename"]');
        var res = Core.renameGroup(state, name, input ? input.value : '');
        if (!res.ok) { msg(out, res.error, false); return; }
        msg(out, t('已改名，同步更新了 {0} 个节点', res.updatedNodes), true);
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
    $('bulk-sub-btn').addEventListener('click', function () {
      var res = Core.parseBulkSubscriptions(state, $('sub-bulk').value);
      var out = $('sub-msg');
      var text = t('批量添加完成：成功 {0} 条', res.added.length);
      if (res.skipped.length) text += t('，跳过 {0} 条（{1}）', res.skipped.length, res.skipped.map(function (s) { return s.reason; }).join(t('；')));
      msg(out, text, res.added.length > 0);
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
    $('import-content-btn').addEventListener('click', function () {
      var out = $('sub-msg');
      var text = $('sub-content').value;
      if (!text.trim()) { msg(out, '请先粘贴要导入的内容', false); return; }
      var target = $('sub-content-group').value.trim() || Core.ALL_GROUP;
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
      if (!cands.length) { msg(out, t('没有从内容里解析出任何节点'), false); return; }
      $('sub-content').value = '';
      importCandidates(cands, errs, out);
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

    $('check-update-btn').addEventListener('click', function () { checkForUpdates(true); });
    $('update-now-btn').addEventListener('click', function () {
      $('update-modal').hidden = true;
      window.open(updateReleaseUrl, '_blank');
    });
    $('update-later-btn').addEventListener('click', function () { $('update-modal').hidden = true; });
  }

  // ---------------------------------------------------------------- 更新检测
  var APP_VERSION = '1.0.9';
  var LATEST_API = 'https://api.github.com/repos/Vardven/node-yml-config-tool/releases/latest';
  var updateReleaseUrl = 'https://github.com/Vardven/node-yml-config-tool/releases/latest';

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
          updateReleaseUrl = d.html_url || updateReleaseUrl;
          $('update-title').textContent = t('发现新版本 v{0}', latest);
          $('update-desc').textContent = t('当前版本 v{0}，最新版本 v{1}。点「立即更新」打开下载页，下载新版本安装即可。', APP_VERSION, latest);
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
