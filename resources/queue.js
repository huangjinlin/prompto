(() => {
  const vscode = acquireVsCodeApi();
  vscode.setState({});
  const element = id => document.getElementById(id);
  let state = { items: [], workflows: [], uri: '', valid: false };
  const send = (type, data = {}) => vscode.postMessage({ type, uri: state.uri, ...data });
  const command = (type, data = {}) => {
    if (type === 'selectFile') state.selecting = true;
    else state.busy = true;
    controls();
    send(type, data);
  };
  function controls() {
    const current = state.items.find(item => item.status === 'doing');
    const pending = state.items.some(item => item.status === 'await');
    const unavailable = !state.uri || state.busy;
    element('select-file').disabled = Boolean(state.selecting);
    element('open-source').disabled = !state.uri;
    element('reload').disabled = unavailable;
    element('run').disabled = Boolean(unavailable || state.dispatchBusy || !state.valid || state.dirty || state.paused || current || !pending);
    element('remove-workflow').disabled = Boolean(unavailable);
    element('confirm').disabled = Boolean(unavailable || !state.valid || state.dirty || !current);
    element('pause').disabled = Boolean(!state.uri || (state.busy && state.paused));
    const pause = element('pause');
    pause.title = state.paused ? '恢复队列（不自动投放）' : '暂停队列';
    pause.setAttribute('aria-label', pause.title);
    pause.firstElementChild.className = 'codicon ' + (state.paused ? 'codicon-debug-continue' : 'codicon-debug-pause');
    const error = state.dirty ? '队列文件在编辑器中有未保存修改，请先保存。' : state.error || '';
    element('error').textContent = error;
    element('error').hidden = !error;
    element('message').textContent = state.message || '';
  }
  function render() {
    const workflows = element('workflows');
    workflows.replaceChildren();
    const workflowLabels = { ready: '可投放', waiting: '待确认', busy: '正在操作', paused: '已暂停', complete: '已完成', dirty: '未保存', error: '异常', deleted: '已删除' };
    for (const workflow of state.workflows || []) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'workflow-choice' + (workflow.uri === state.uri ? ' selected' : '');
      button.setAttribute('aria-pressed', String(workflow.uri === state.uri));
      button.title = `${workflow.directory}\n${workflow.fileName}${workflow.error ? '\n' + workflow.error : ''}`;
      button.onclick = () => send('selectWorkflow', { uri: workflow.uri });
      const title = document.createElement('span');
      title.className = 'workflow-name';
      title.textContent = workflow.fileName;
      const progress = document.createElement('span');
      progress.className = 'workflow-progress';
      progress.textContent = `${workflow.done} / ${workflow.total}`;
      const meta = document.createElement('span');
      meta.className = 'workflow-meta';
      meta.textContent = workflowLabels[workflow.status] + (workflow.current ? ' · ' + workflow.current : '');
      button.append(title, progress, meta);
      row.append(button);
      workflows.append(row);
    }
    element('workflow-empty').hidden = Boolean(state.workflows?.length);
    element('open-source').textContent = state.fileName || '未选择队列文件';
    element('open-source').title = state.uri || '在编辑器打开队列文件';
    const done = state.items.filter(item => item.status === 'done').length;
    element('progress-label').textContent = `已确认 ${done} / ${state.items.length}`;
    element('progress').max = Math.max(1, state.items.length);
    element('progress').value = done;
    const modeLabels = { chatPrefill: '预填', chatSubmit: '发送', clipboard: '复制' };
    element('mode-label').textContent = state.uri ? '默认：' + modeLabels[state.outputMode] : '';
    const list = element('items');
    list.replaceChildren();
    const labels = { await: '待执行', doing: '待确认', done: '已确认' };
    const icons = { await: 'circle-outline', doing: 'circle-filled', done: 'check' };
    for (const item of state.items) {
      const row = document.createElement('li');
      row.className = 'queue-item ' + item.status + (item.status === 'doing' ? ' current' : '');
      const icon = document.createElement('i');
      icon.className = 'item-icon codicon codicon-' + (state.busy && item.status === 'doing' ? 'loading codicon-modifier-spin' : icons[item.status]);
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = item.section;
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = `${item.id} · ${labels[item.status]} · ${modeLabels[item.outputMode ?? state.outputMode]}\n${item.context}`;
      text.append(title, meta);
      row.append(icon, text);
      list.append(row);
    }
    element('empty').hidden = state.items.length > 0;
    element('empty').textContent = state.uri ? (state.valid ? '队列为空' : '队列数据无效') : '未选择队列文件';
    controls();
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'state') {
      state = message.state;
      render();
    }
  });
  element('select-file').onclick = () => command('selectFile');
  element('open-source').onclick = () => send('openSource');
  element('reload').onclick = () => command('reload');
  element('remove-workflow').onclick = () => command('removeWorkflow');
  element('run').onclick = () => command('runNext');
  element('pause').onclick = () => send('togglePause');
  element('confirm').onclick = () => command('confirm', { id: state.items.find(item => item.status === 'doing')?.id });
  render();
  send('ready');
})();