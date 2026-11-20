// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const phases = {
    queued: '已排队，等待服务器处理',
    checking: '正在核对发布版本',
    downloading: '正在下载程序',
    'backing-up': '正在备份资料',
    installing: '正在安装并重启',
    verifying: '正在检查新版是否可用',
    'rolling-back': '正在恢复旧版',
    succeeded: '更新完成',
    'rolled-back': '更新失败，已恢复旧版',
    failed: '这次更新未完成'
  };
  const terminal = new Set(['succeeded', 'rolled-back', 'failed']);
  let recentCheck = null;
  let checkedAt = 0;
  const isActive = job => job?.phase && !terminal.has(job.phase);
  const api = (...args) => window.Pipi.api(...args);

  async function check(force = false) {
    if (!force && recentCheck && Date.now() - checkedAt < 30000) return recentCheck;
    recentCheck = await api('/api/updates/check' + (force ? '?refresh=1' : ''));
    checkedAt = Date.now();
    return recentCheck;
  }

  function bindSettings(container) {
    const row = container.querySelector('[data-action="about"]');
    if (!row) return;
    check().then(result => {
      if (!row.isConnected) return;
      const label = isActive(result.job) ? '更新中' : result.state === 'available' ? '有新版本' : '';
      if (!label) return;
      const value = document.createElement('span');
      value.className = 'cell-value update-badge';
      value.textContent = label;
      row.querySelector('.cell-body').after(value);
    }).catch(() => {});
  }

  function markup() {
    return `<section class="section software-update" aria-labelledby="software-update-title" data-software-update>
      <h3 id="software-update-title">版本更新</h3>
      <p class="software-update-status" role="status">正在检查更新…</p>
      <p class="software-update-detail" hidden></p>
      <pre class="software-update-notes" aria-label="更新说明" tabindex="0" hidden></pre>
      <div class="software-update-actions">
        <button class="secondary-btn" type="button" data-update-check>检查更新</button>
        <button class="primary-btn" type="button" data-update-install hidden>立即更新</button>
        <button class="secondary-btn" type="button" data-update-reload hidden>刷新页面</button>
      </div>
    </section>`;
  }

  function bindAbout(container) {
    const panel = container.querySelector('[data-software-update]');
    if (!panel) return;
    const status = panel.querySelector('.software-update-status');
    const detail = panel.querySelector('.software-update-detail');
    const notes = panel.querySelector('.software-update-notes');
    const checkButton = panel.querySelector('[data-update-check]');
    const installButton = panel.querySelector('[data-update-install]');
    const reloadButton = panel.querySelector('[data-update-reload]');
    let data;
    let timer;

    function render(result) {
      if (!panel.isConnected) return;
      data = result;
      const job = result.job;
      const active = isActive(job);
      const latest = result.state === 'available' ? result.release : null;
      const checkFailed = result.state === 'offline' || result.state === 'disabled';
      const showJob = active || !checkFailed && job && terminal.has(job.phase) && (!latest || latest.version === job.version);
      const line = showJob ? phases[job.phase] : latest ? '发现新版本 v' + latest.version :
        result.state === 'disabled' ? '未配置版本发布来源' :
        result.state === 'offline' ? '暂时无法检查更新' :
        result.release ? '当前已是最新版本' : '暂无正式发布版本';
      status.textContent = line;
      const workVersion = showJob && job?.version && job.phase !== 'succeeded' ? '目标版本 v' + job.version : '';
      detail.textContent = [workVersion, showJob && job.message, result.reason].filter(Boolean).join(' · ');
      detail.hidden = !detail.textContent;
      notes.textContent = latest ? 'v' + latest.version + (latest.notes ? '\n' + latest.notes : '') : '';
      notes.hidden = !notes.textContent;
      const versionDisplay = container.querySelector('.about-logo p');
      if (versionDisplay && result.currentVersion) versionDisplay.textContent = 'v' + result.currentVersion;
      checkButton.disabled = Boolean(active);
      installButton.hidden = !latest || !result.canUpdate || Boolean(active);
      reloadButton.hidden = !showJob || job.phase !== 'succeeded' && job.phase !== 'rolled-back';
      clearTimeout(timer);
      if (active) timer = setTimeout(poll, 2000);
    }

    async function poll() {
      if (!panel.isConnected) return;
      try {
        const next = await api('/api/updates/status');
        const result = {...data, ...next, state: next.job?.phase === 'succeeded' ? 'ok' : data?.state};
        if (next.job?.phase === 'succeeded') result.release = {version: next.currentVersion};
        recentCheck = result;
        checkedAt = Date.now();
        render(result);
      } catch (error) {
        if (!panel.isConnected || error.status === 401) return;
        status.textContent = '等待小手机重新连接…';
        timer = setTimeout(poll, 2000);
      }
    }

    async function refresh(force) {
      checkButton.disabled = true;
      status.textContent = '正在检查更新…';
      try {
        render(await check(force));
      } catch (error) {
        if (!panel.isConnected) return;
        status.textContent = error.message;
        checkButton.disabled = false;
      }
    }

    checkButton.onclick = () => refresh(true);
    reloadButton.onclick = () => window.location.reload();
    installButton.onclick = () => {
      const version = data?.release?.version;
      if (!version || !data.canUpdate) return;
      window.Pipi.confirmDialog('更新到 v' + version + '？',
        '服务器会先备份数据，再安装并重启小手机。更新期间服务会暂时中断，请先保存手上的内容。',
        async () => {
          const queued = await api('/api/updates/install', {version});
          recentCheck = queued;
          checkedAt = Date.now();
          render(queued);
        }, '立即更新');
    };
    void refresh(false);
  }

  window.PipiUpdates = {markup, bindAbout, bindSettings};
})();
