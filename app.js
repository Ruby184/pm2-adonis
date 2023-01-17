const { Entrypoint } = require('@pm2/io')
const pm2 = require('pm2')

class App extends Entrypoint {
  onStart (cb) {
    this._config = this.io.initModule({
      events: ['adonis:hop']
    })
    
    pm2.connect((err) => {
      if (err) {
        return cb(err)
      }

      pm2.launchBus((err, bus) => {
        if (err) {
          return cb(err)
        }

        this._bus = bus

        cb()
      })
    })
  }

  onStop (_err, cb) {
    pm2.disconnect(cb)
  }

  sensors () {
    this._processes = new Map()

    this.io.gauge({
      name: 'Processes',
      value: () => JSON.stringify([...this._processes.entries()].reduce((res, [name, ids]) => {
        res[name] = [...ids]
        return res
      }, {}))
    })

    this._eventsCounter = this.io.counter({
      name: 'Total broadcasted',
      unit: 'events'
    })
    
    this._eventsMeter = this.io.meter({
      name: 'Events recieved',
      unit: 'evts/sec'
    })

    this._buildProcessList(() => {
      this._bus.on('process:event', this._onProcessEvent.bind(this))

      for (const event of this._config.events) {
        this._bus.on(event, this._onBroadcast.bind(this, event))
      }
    })
  }

  _buildProcessList (cb) {
    pm2.list((err, list) => {
      if (err) {
        return cb(err)
      }

      list.forEach((proc) => this._addProcess(proc.pm2_env))

      cb()
    })
  }

  _onProcessEvent ({ process, event }) {
    if (event === 'online') {
      this._addProcess(process)
    } else if (event === 'exit') {
      this._deleteProcess(process)
    }
  }

  _onBroadcast (type, { process, data }) {
    if (!this._processes.has(process.name)) {
      return
    }

    this._processes.get(process.name).forEach((pid) => {
      if (pid === process.pm_id) {
        return
      }

      pm2.sendDataToProcessId(pid, { type, topic: 'broadcast', data }, (err) => {
        if (err) {
          return this.io.notifyError(err)
        }
      })
    })

    this._eventsCounter.inc()
    this._eventsMeter.mark()
  }  

  _addProcess (proc) {
    if (proc.exec_mode !== 'cluster_mode') {
      return
    }

    if (!this._processes.has(proc.name)) {
      this._processes.set(proc.name, new Set())
    }

    this._processes.get(proc.name).add(proc.pm_id)
  }

  _deleteProcess (proc) {
    if (!this._processes.has(proc.name)) {
      return
    }

    const ids = this._processes.get(proc.name)

    if (ids.delete(proc.pm_id) && ids.size === 0) {
      this._processes.delete(proc.name)
    }
  }
}

new App()
