const fs = require('fs')
const tmp = require('tmp')
const unzip = require('unzip2')

const deleteFile = (path) => {
    return new Promise((resolve, reject) => {
        fs.exists(path, (exists) => {
            if (!exists) return resolve()
            fs.unlink(path, (err) => {
                if (err) return reject(err)
                return resolve()
            })
        })
    })
}

const copyFile = (src, dest, force) => {
    return new Promise((resolve, reject) => {
        fs.exists(src, (exists) => {
            if (!exists) return reject(Error('Source does not exist'))
            fs.exists(dest, (exists) => {
                if (exists && !force) return reject(Error('Destination exists'))
                let p = (exists ? deleteFile(dest) : Promise.resolve())
                p.then(() => {
                    fs.copyFile(src, dest, (err) => {
                        if (err) return reject(Error('Unable to copy source to destination'))
                        return resolve()
                    })
                }).catch(err => {
                    return reject(err)
                })
            })
        })
    })
}

const readFile = (path) => {
    return new Promise((resolve, reject) => {
        fs.exists(path, (exists) => {
            if (!exists) return reject(Error('Supplied path doesn\'t exist'))
            fs.readFile(path, 'utf-8', (err, str) => {
                if (err) return reject('Unable to read file')
                return resolve(str)
            })
        })
    })
}

const createTempFile = () => {
    return new Promise((resolve, reject) => {
        let options = {'discardDescriptor': process.platform === "win32" ? true : false}
        tmp.file(options, (err, tmppath, fd, callback) => {
            if (err) return reject(err)
            return resolve(tmppath)
        })
    })
}

const createTempDir = () => {
    return new Promise((resolve, reject) => {
        let options = {'unsafeCleanup': true, 'discardDescriptor': process.platform === "win32" ? true : false}
        tmp.dir(options, (err, tmppath, callback) => {
            if (err) return reject(err)
            return resolve(tmppath)
        })
    })
}

const unzipFile = (file, dest) => {
    return new Promise((resolve, reject) => {
        fs.createReadStream(file).pipe(unzip.Extract({path: dest})).on('error', (err) => {
            return reject(err)
        }).on('close', () => {
            return resolve()
        })
    })
}

module.exports = {
    deleteFile,
    copyFile,
    readFile,
    createTempFile,
    createTempDir,
    unzipFile
}