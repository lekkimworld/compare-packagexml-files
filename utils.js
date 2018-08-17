const path = require('path')

const getPackageXMLPath = (options, base) => {
    if (options.packagexml) {
        return path.join(base, 'unpackaged', 'package.xml')
    } else {
        return path.join(base, 'package.xml')
    }
}

const getTimestamp = () => {
    const d = new Date()
    const pad = (value) => (value < 10 ? `0${value}` : value)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth())}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
}

module.exports = {
    getPackageXMLPath,
    getTimestamp
}
