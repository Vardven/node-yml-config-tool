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
        if (s && Array.isArray(s.nodes) && Array.isArray(s.groups) && Array.isArray(s.subscriptions)) return s;
      }
    } catch (e) { /* 忽略损坏的本地数据 */ }
    return Core.emptyState();
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
  }

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
    $('node-count').textContent = '共 ' + state.nodes.length + ' 个节点' + (list.length !== state.nodes.length ? '，筛选后 ' + list.length + ' 个' : '');
    $('node-empty').style.display = state.nodes.length ? 'none' : 'block';
    $('node-list').innerHTML = list.map(function (n) {
      var name = Core.buildNodeName(n);
      return '<div class="card">' +
        '<div class="card-head"><strong>' + esc(name) + '</strong><span class="badge">' + esc(n.type) + '</span></div>' +
        '<pre class="yaml">' + esc(Core.nodeYaml(n)) + '</pre>' +
        '<div class="row">' +
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
  function renderGroups() {
    var groups = Core.listGroups(state);
    $('group-empty').style.display = groups.length ? 'none' : 'block';
    $('group-list').innerHTML = groups.map(function (g) {
      return '<div class="card"><div class="card-head"><strong>' + esc(g.name) + '</strong><span>' + g.count + ' 个节点</span></div>' +
        '<div class="row">' +
        '<input type="text" placeholder="新分组名" id="rename-' + cssId(g.name) + '">' +
        '<button data-gact="rename" data-name="' + esc(g.name) + '">重命名</button>' +
        '<button data-gact="del" data-name="' + esc(g.name) + '" class="danger">删除</button>' +
        '</div></div>';
    }).join('');
    renderGroupDatalist();
  }
  function cssId(name) { return 'g' + Array.prototype.map.call(name, function (c) { return c.charCodeAt(0).toString(36); }).join(''); }
  function renderGroupDatalist() {
    $('group-datalist').innerHTML = Core.listGroups(state).map(function (g) {
      return '<option value="' + esc(g.name) + '">';
    }).join('');
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
        '</div></div>';
    }).join('');
  }

  function renderAll() { renderNodes(); renderGroups(); renderSubs(); renderYaml(); }
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
      groupName: $('f-group').value.trim(),
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
    $('f-group').value = n.groupName || '';
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

  function onParse() {
    var text = $('link-input').value.trim();
    var out = $('parse-msg');
    if (!text) { msg(out, '请先粘贴分享链接', false); return; }
    var first = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0];
    var r = Core.parseShareLink(first);
    if (!r.ok) { msg(out, r.error, false); return; }
    fillForm({ groupName: '', location: r.suggestedLocation || '', server: r.server, port: r.port, type: r.type, details: r.details });
    msg(out, '已解析：' + r.type + ' / ' + r.server + ':' + r.port + '。' + (r.locationNote || '') + ' 请填分组名后保存。', true);
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
      if (dup) { msg(out, '节点名重复：' + Core.buildNodeName(node), false); return; }
      node.id = editingNodeId;
      state.nodes[idx] = node;
      if (state.groups.indexOf(node.groupName) === -1) state.groups.push(node.groupName);
      editingNodeId = null;
      $('save-node-btn').textContent = '保存节点';
      msg(out, '已更新节点：' + Core.buildNodeName(node), true);
    } else {
      var res = Core.addNode(state, node);
      if (!res.ok) { msg(out, res.error, false); return; }
      msg(out, '已添加节点：' + res.node.name, true);
    }
    save(); renderAll();
  }

  // ---------------------------------------------------------------- 事件绑定
  function bind() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'export') renderYaml();
      });
    });

    $('node-search').addEventListener('input', renderNodes);
    $('node-group-filter').addEventListener('change', renderNodes);
    $('node-type-filter').addEventListener('change', renderNodes);
    $('node-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var id = btn.dataset.id;
      var node = state.nodes.find(function (n) { return n.id === id; });
      if (!node) return;
      if (btn.dataset.act === 'del') {
        if (confirm('删除节点 ' + Core.buildNodeName(node) + '？')) {
          state.nodes = state.nodes.filter(function (n) { return n.id !== id; });
          save(); renderAll();
        }
      } else if (btn.dataset.act === 'edit') {
        editingNodeId = id;
        fillForm(node);
        $('save-node-btn').textContent = '保存修改';
        document.querySelector('[data-tab="add"]').click();
      }
    });

    $('parse-btn').addEventListener('click', onParse);
    $('save-node-btn').addEventListener('click', onSaveNode);
    $('clear-form-btn').addEventListener('click', function () {
      editingNodeId = null;
      $('save-node-btn').textContent = '保存节点';
      fillForm({ details: {} });
      $('f-group').value = ''; $('f-location').value = ''; $('f-server').value = ''; $('f-port').value = '';
    });

    $('add-group-btn').addEventListener('click', function () {
      var res = Core.addGroup(state, $('new-group-name').value);
      var out = $('group-msg');
      if (!res.ok) { msg(out, res.error, false); return; }
      $('new-group-name').value = '';
      msg(out, '分组已创建', true);
      save(); renderAll();
    });
    $('group-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var name = btn.dataset.name;
      var out = $('group-msg');
      if (btn.dataset.gact === 'rename') {
        var input = $('rename-' + cssId(name));
        var res = Core.renameGroup(state, name, input ? input.value : '');
        if (!res.ok) { msg(out, res.error, false); return; }
        msg(out, '已改名，同步更新了 ' + res.updatedNodes + ' 个节点', true);
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
      msg(out, '已添加订阅：' + res.sub.name, true);
      save(); renderAll();
    });
    $('bulk-sub-btn').addEventListener('click', function () {
      var res = Core.parseBulkSubscriptions(state, $('sub-bulk').value);
      var out = $('sub-msg');
      var text = '批量添加完成：成功 ' + res.added.length + ' 条';
      if (res.skipped.length) text += '，跳过 ' + res.skipped.length + ' 条（' + res.skipped.map(function (s) { return s.reason; }).join('；') + '）';
      msg(out, text, res.added.length > 0);
      save(); renderAll();
    });
    $('sub-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var sub = state.subscriptions.find(function (s) { return s.id === btn.dataset.id; });
      if (!sub) return;
      var out = $('sub-msg');
      if (btn.dataset.sact === 'toggle') { revealSubs[sub.id] = !revealSubs[sub.id]; renderSubs(); return; }
      if (btn.dataset.sact === 'del') {
        if (confirm('删除订阅「' + sub.name + '」？')) { state.subscriptions = state.subscriptions.filter(function (s) { return s.id !== sub.id; }); }
      } else if (btn.dataset.sact === 'rename') {
        var nn = prompt('新的订阅名：', sub.name);
        if (nn && nn.trim()) {
          if (state.subscriptions.some(function (s) { return s.id !== sub.id && s.name === nn.trim(); })) { msg(out, '订阅名已存在', false); return; }
          sub.name = nn.trim();
        }
      } else if (btn.dataset.sact === 'url') {
        var nu = prompt('新的订阅链接：', sub.url);
        if (nu && nu.trim()) {
          if (!/^https?:\/\/\S+$/i.test(nu.trim())) { msg(out, '不是有效的 http(s) 链接', false); return; }
          if (state.subscriptions.some(function (s) { return s.id !== sub.id && s.url === nu.trim(); })) { msg(out, '该链接已经存在', false); return; }
          sub.url = nu.trim();
        }
      }
      save(); renderAll();
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
          if (!s || !Array.isArray(s.nodes) || !Array.isArray(s.groups) || !Array.isArray(s.subscriptions)) throw new Error('格式不对');
          state = s; save(); renderAll();
          msg($('export-msg'), '备份已导入', true);
        } catch (err) { msg($('export-msg'), '导入失败：' + err.message, false); }
      };
      reader.readAsText(file);
      this.value = '';
    });

    $('check-update-btn').addEventListener('click', function () { checkForUpdates(true); });
    $('update-now-btn').addEventListener('click', function () {
      $('update-modal').hidden = true;
      window.open(updateReleaseUrl, '_blank');
    });
    $('update-later-btn').addEventListener('click', function () { $('update-modal').hidden = true; });
  }

  // ---------------------------------------------------------------- 更新检测
  var APP_VERSION = '1.0.0';
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
          $('update-title').textContent = '发现新版本 v' + latest;
          $('update-desc').textContent = '当前版本 v' + APP_VERSION + '，最新版本 v' + latest + '。点「立即更新」打开下载页，下载新版本安装即可。';
          $('update-modal').hidden = false;
          if (manual && out) msg(out, '发现新版本 v' + latest, true);
        } else if (manual && out) {
          msg(out, '已是最新版本（v' + APP_VERSION + '）', true);
        }
      })
      .catch(function () {
        if (manual && out) msg(out, '检查更新失败，请检查网络后重试', false);
      });
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  bind();
  renderAll();
  checkForUpdates(false);
})();
