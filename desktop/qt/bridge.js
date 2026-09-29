;(() => {
  const listeners = new Map()
  const pending = new Map()
  let sequence = 0
  const connected = new Promise((resolve) => {
    new QWebChannel(qt.webChannelTransport, (channel) => {
      const native = channel.objects.desktop
      native.reply.connect((id, response) => {
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        if (response.error) entry.reject(new Error(response.error))
        else entry.resolve(response.value)
      })
      native.event.connect((name, value) => {
        for (const callback of listeners.get(name) || []) callback(value)
      })
      resolve(native)
    })
  })
  const call = async (method, ...args) => {
    const native = await connected
    return new Promise((resolve, reject) => {
      const id = String(++sequence)
      pending.set(id, { resolve, reject })
      native.call(id, method, args)
    })
  }
  const on = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(callback)
    return () => listeners.get(name).delete(callback)
  }
  window.derpDesktop = {
    ready: () => call('ready'),
    onOpen: (callback) => on('open', callback),
    onPicker: (callback) => on('picker', callback),
    onBeforeClose: (callback) =>
      on('before-close', () => {
        Promise.resolve()
          .then(callback)
          .then(
            () => call('close-ready'),
            (error) => call('close-ready', String(error)),
          )
      }),
    open: (path, reader = false) => call('open', path, reader),
    openRoot: () => call('open', ''),
    copy: (paths) => call('copy', paths),
    drag: (paths) => call('drag', paths),
    paste: (directory) => call('paste', directory),
    hasFileClipboard: () => call('has-files'),
    importDrop: (_files, directory) => call('import-drop', directory),
    openDrop: () => call('open-drop'),
    pick: (selection) => call('pick', selection),
    close: () => {
      void call('close')
    },
  }
})()
