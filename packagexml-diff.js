#!/usr/bin/env node

const path = require('path')
const fsutil = require('./async-fs-utils.js')
const lineRemove = require('./async-line-remove.js')
const lineNumber = require('line-number')
const diff = require('diff')
const log = require('./log.js')
const commandLineUsage = require('command-line-usage')
const commandLineArgs = require('command-line-args')
const SalesforceDX = require('sfdx-bulk-helper')

// constants
const DEFAULT_PACKAGENAME = 'becem'
const DEFAULT_PACKAGEXML = 'package.xml'
const DEFAULT_WAIT = 100

// configure command line args
const cmdLineOptsRequired = [
    {name: 'org1', type: String, description: 'Username / alias of the first SalesforceDX org to use for compare'},
    {name: 'org2', type: String, description: 'Username / alias of the second SalesforceDX org to use for compare'}
]
const cmdLineOptsOptional = [
    {name: 'packagename', type: String, defaultValue: DEFAULT_PACKAGENAME, description: `Allows you to override the package name to read metadata for (defaults to "${DEFAULT_PACKAGENAME}")`},
    {name: 'packagexml', type: String, description: 'Complete path to a package.xml file to use when retrieving metadata. If not specified we retrieve a package (see --packagename)'},
    {name: 'verbose', type: Boolean, defaultValue: false, description: 'Be more verbose in the output'},
    {name: 'sfdx-verbose', type: Boolean, defaultValue: false, description: 'Be more verbose in the SalesforceDX output'},
    {name: 'help', type: Boolean, defaultValue: false, description: 'Shows this help'}
]
const options = (function() {
    try {
        const opts = commandLineArgs(cmdLineOptsRequired.concat(cmdLineOptsOptional), {'argv': process.argv})
        return opts

    } catch (err) {
        return {
            parseError: true,
            parseMessage: err.message
        }
    }
})()
if (options.parseError || options.help || !options.org1 || !options.org2) {
    if (options.parseError) console.log(`!! Error parsing command line <${options.parseMessage}> !!`)
    console.log(commandLineUsage([
        {header: 'Package XML Compare Tool', content: 'Reads metadata from two Salesforce orgs using SalesforceDX and compares the package.xml removing namespacePrefix if found.'},
        {header: 'Required Options', optionList: cmdLineOptsRequired},
        {header: 'Optional Options', optionList: cmdLineOptsOptional}
    ]))
}

// show runtime info
log.info(`Using org1 value <${options.org1}>`)
log.info(`Using org2 value <${options.org2}>`)
if (options.packagexml) {
    log.info(`Using package.xml at <${options.packagexml}>`)
} else {
    log.info(`Using package name value <${options.packagename}>`)
}

// create shared state
const sharedContext = {
    sfdx1: new SalesforceDX(options.org1, options['sfdx-verbose']), 
    sfdx2: new SalesforceDX(options.org2, options['sfdx-verbose'])
}

// ensure the org exists
log.info('Making sure orgs are available in SalesforceDX')
Promise.all([sharedContext.sfdx1.ensureOrgConnected(), sharedContext.sfdx2.ensureOrgConnected()]).then(() => {
    log.info('Both orgs are available in SalesforceDX - creating temp dirs')
    // create two temp dirs
    return Promise.all([
        fsutil.createTempDir(),
        fsutil.createTempDir()
    ])
}).then(tempdirs => {
    // save temp dirs in state
    sharedContext.tmpdir1 = tempdirs[0]
    sharedContext.tmpdir2 = tempdirs[1]

    // request metadata from orgs
    let cmd
    if (options.packagexml) {
        log.info('Using package.xml as metadata source')
        cmd = `--unpackaged ${options.packagexml}`
    } else {
        log.info('Using package name as metadata source')
        cmd = `--singlepackage --packagenames ${options.packagename}`
    }
    cmd += ` --wait ${DEFAULT_WAIT}`
    return Promise.all([
        sharedContext.sfdx1.executeSFDXCommand(`force:mdapi:retrieve ${cmd} --retrievetargetdir ${sharedContext.tmpdir1}`),
        sharedContext.sfdx2.executeSFDXCommand(`force:mdapi:retrieve ${cmd} --retrievetargetdir ${sharedContext.tmpdir2}`)
    ])
    log.info('Starting to retrieve metadata for orgs')
}).then(() => {
    log.info('Retrieved metadata for both orgs - unzipping')
    return Promise.all([
        fsutil.unzipFile(path.join(sharedContext.tmpdir1, 'unpackaged.zip'), sharedContext.tmpdir1),
        fsutil.unzipFile(path.join(sharedContext.tmpdir2, 'unpackaged.zip'), sharedContext.tmpdir2)
    ])

}).then(() => {
    log.info('Unzipped metadata - inspecting package.xml files')
    const readPackageXmls = () => {
        return Promise.all([
            options.packagexml ? fsutil.readFile(path.join(sharedContext.tmpdir1, 'unpackaged', DEFAULT_PACKAGEXML)) : fsutil.readFile(path.join(sharedContext.tmpdir1, DEFAULT_PACKAGEXML)),
            options.packagexml ? fsutil.readFile(path.join(sharedContext.tmpdir2, 'unpackaged', DEFAULT_PACKAGEXML)) : fsutil.readFile(path.join(sharedContext.tmpdir2, DEFAULT_PACKAGEXML))
        ])
    }
    // see if we are using package.xml
    if (options.packagexml) {
        log.info('Using package.xml so ignoring detection of namespacePrefix')
        return readPackageXmls()
    }

    return new Promise((resolve, reject) => {
        log.info('Using package name so detect and remove of namespacePrefix if present')
        readPackageXmls().then(fileContents => {
            const re = /<namespacePrefix>[-_A-Za-z0-9]+<\/namespacePrefix>/
            const lineNoResult1 = lineNumber(fileContents[0], re)
            const lineNoResult2 = lineNumber(fileContents[1], re)
            const promises = []
            if (lineNoResult1 && lineNoResult1.length === 1) {
                log.info(`Removing line ${lineNoResult1[0].number} in package.xml from org1`)
                promises.push(lineRemove(path.join(sharedContext.tmpdir1, DEFAULT_PACKAGEXML), lineNoResult1[0].number))
            }
            if (lineNoResult2 && lineNoResult2.length === 1) {
                log.info(`Removing line ${lineNoResult2[0].number} in package.xml from org2`)
                promises.push(lineRemove(path.join(sharedContext.tmpdir2, DEFAULT_PACKAGEXML), lineNoResult2[0].number))
            }
            return Promise.all(promises)
        }).then(() => {
            return readPackageXmls()
        }).then(fileContents => {
            resolve(fileContents)
        }).catch(err => {
            reject(err)
        })
    })

}).then(fileContents => {
    // perform diff
    const changes = diff.diffTrimmedLines(fileContents[0], fileContents[1])
    
    // filter out any parts that doesn't have a change or addition
    const filteredChanges = changes.filter(part => part.hasOwnProperty('changed') || part.hasOwnProperty('added'))
    if (filteredChanges.length) {
        log.info('!! THERE ARE DIFFERENCES BETWEEN THE FILES !!')
        filteredChanges.forEach((part) => {
            log.info(`${part.added ? 'ADDED' : 'REMOVED'}: ${part.value.trim()}`)
        })
        return Promise.resolve(1)
    } else {
        log.info('The files are the same')
        return Promise.resolve(0)
    }
}).then((rc = 1) => {
    // exit
    return process.exit(rc)

}).catch(err => {
    log.error('Unable to complete operation', err)
    process.exit(1)
})
