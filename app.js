const io = require('@pm2/io')
const pm2 = require('pm2')

const BROADCAST_EVENT_TYPE = 'adonis:hop'

class Entrypoint extends io.Entrypoint {
  onStart (cb) {
    pm2.launchBus((err, bus) => {
      if (err) {
        return cb(err)
      }

      bus.on(BROADCAST_EVENT_TYPE, this._onBroadcast.bind(this))

      cb()
    })
  }

  _onBroadcast({ process: proc, data }) {
    pm2.Client.getProcessByName(proc.name, (err, workers) => {
      if (err) {
        return this.io.notifyError(err)
      }

      workers.forEach((worker) => {
        const wid = worker.pm2_env.pm_id

        if (wid === proc.pm_id) {
          return
        }

        pm2.sendDataToProcessId(wid, {
          type: BROADCAST_EVENT_TYPE,
          topic: data.handle,
          data
        }, (err, res) => {
          if (err) {
            return this.io.notifyError(err)
          }
        })
      })
    })
  }
}

new Entrypoint()
