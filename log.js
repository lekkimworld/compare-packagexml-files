
const log = (level, msg, err) => {
    const strlevel = level === 'debug' ? 'DEBUG' : level === 'info' ? 'INFO' : 'ERROR'
    err ? console.log(`${strlevel} - ${msg}`, err) : console.log(`${strlevel} - ${msg}`)
}
const logobj = Object.freeze({
    debug: (msg) => log('debug', msg),
    info: (msg) => log('info', msg),
    error: (msg, err) => log('error ', msg, err)
})
module.exports = logobj
