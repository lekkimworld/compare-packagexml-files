#!/usr/bin/env node

const path = require('path')
const fsutil = require('./async-fs-utils.js')
const lineRemove = require('./async-line-remove.js')
const lineNumber = require('line-number')
const diff = require('diff')
const fs = require('fs')
const utils = require('./utils.js')
const Logger = require('./log.js')
const commandLineUsage = require('command-line-usage')
const commandLineArgs = require('command-line-args')
const SalesforceDX = require('sfdx-bulk-helper')

// constants
const DEFAULT_PACKAGENAME = 'becem'
const DEFAULT_WAIT = 100

// configure command line args and show help if required / appropriate
const cmdLineOptsRequired = [
    {name: 'org1', type: String, description: 'Username / alias of the first SalesforceDX org to use for compare'},
    {name: 'org2', type: String, description: 'Username / alias of the second SalesforceDX org to use for compare'}
]
const cmdLineOptsOptional = [
    {name: 'packagename', type: String, defaultValue: DEFAULT_PACKAGENAME, description: `Allows you to override the package name to read metadata for (defaults to "${DEFAULT_PACKAGENAME}")`},
    {name: 'packagexml', type: String, description: 'Complete path to a package.xml file to use when retrieving metadata. If not specified we retrieve based on package name (see --packagename)'},
    {name: 'save-packagexml', type: String, defaultValue: 'never', description: 'Save the retrieved package.xml files as package-1-<timestamp>.xml and package-2-<timestamp>.xml in the "--save-dir" directory (see below). Valid values are: "diff" (save if files are different), "always" (always save), "never" (never save - duh!) with "never" being the default)'},
    {name: 'save-dir', type: String, defaultValue: __dirname, description: `Complete path of a directory to use when saving package.xml files if applicable (see --save-packagexml). If not supplied using __dirname (<${__dirname}>)`},
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
const argsValid = (function() {
    if (options.parseError || options.help) return false
    if (!options.org1 || !options.org2) return false
    if (options['save-packagexml'] && !['diff', 'always', 'never'].includes(options['save-packagexml'])) {
        options.parseError = true
        options.parseMessage = `Invalid value (<${options['save-packagexml']}>) for --save-packagexml`
        return false
    }
    if (options['save-dir'] && !fs.existsSync(options['save-dir'])) {
        options.parseError = true
        options.parseMessage = `Specified path to --save-dir does NOT exist`
        return false
    }
    return true
})()
if (!argsValid) {
    if (options.parseError) console.log(`!! Error parsing command line or invalid value supplied <${options.parseMessage}> !!`)
    console.log(commandLineUsage([
        {header: 'Package XML Compare Tool', 
            content: 'Reads metadata from two Salesforce orgs using SalesforceDX and compares the package.xml removing namespacePrefix if found and metadata is read based on a package name.'
        },
        {header: 'Required Options', optionList: cmdLineOptsRequired},
        {header: 'Optional Options', optionList: cmdLineOptsOptional}
    ]))
    process.exit(0)
}

// configure logging
const log = new Logger(options.verbose)

// show runtime info
log.info(`Using org1 value <${options.org1}>`)
log.info(`Using org2 value <${options.org2}>`)
if (options.packagexml) {
    log.info(`Using package.xml at <${options.packagexml}>`)
} else {
    log.info(`Using package name value <${options.packagename}>`)
}
if (options['save-packagexml']) {
    log.info(`save-packagexml switch set to <${options['save-packagexml']}>`)
}
if (options['save-dir']) {
    log.info(`save-dir switch set to <${options['save-dir']}>`)
}

// create shared state
const sharedContext = {
    sfdx1: new SalesforceDX(options.org1, options['sfdx-verbose']), 
    sfdx2: new SalesforceDX(options.org2, options['sfdx-verbose'])
}
log.verbose('Created SalesforceDX instances')

// ensure the org exists
log.verbose('Making sure orgs are available in SalesforceDX')
Promise.all([sharedContext.sfdx1.ensureOrgConnected(), sharedContext.sfdx2.ensureOrgConnected()]).then(() => {
    log.verbose('Both orgs are available in SalesforceDX - creating temp dirs')
    // create two temp dirs
    return Promise.all([
        fsutil.createTempDir(),
        fsutil.createTempDir()
    ])
}).then(tempdirs => {
    // save temp dirs in state
    sharedContext.tmpdir1 = tempdirs[0]
    sharedContext.tmpdir2 = tempdirs[1]
    log.verbose(`Temp-dir 1 <${tempdirs[0]}>`)
    log.verbose(`Temp-dir 2 <${tempdirs[1]}>`)

    // request metadata from orgs
    let cmd
    if (options.packagexml) {
        log.verbose('Using package.xml as metadata source')
        cmd = `--unpackaged ${options.packagexml}`
    } else {
        log.verbose('Using package name as metadata source')
        cmd = `--singlepackage --packagenames ${options.packagename}`
    }
    cmd += ` --wait ${DEFAULT_WAIT}`
    log.verbose('Starting to retrieve metadata for orgs')
    return Promise.all([
        sharedContext.sfdx1.executeSFDXCommand(`force:mdapi:retrieve ${cmd} --retrievetargetdir ${sharedContext.tmpdir1}`),
        sharedContext.sfdx2.executeSFDXCommand(`force:mdapi:retrieve ${cmd} --retrievetargetdir ${sharedContext.tmpdir2}`)
    ])

}).then(() => {
    log.verbose('Retrieved metadata for both orgs - unzipping')
    return Promise.all([
        fsutil.unzipFile(path.join(sharedContext.tmpdir1, 'unpackaged.zip'), sharedContext.tmpdir1),
        fsutil.unzipFile(path.join(sharedContext.tmpdir2, 'unpackaged.zip'), sharedContext.tmpdir2)
    ])

}).then(() => {
    log.verbose('Unzipped metadata - inspecting package.xml files')
    const readPackageXmls = () => {
        return Promise.all([
            fsutil.readFile(utils.getPackageXMLPath(options, sharedContext.tmpdir1)),
            fsutil.readFile(utils.getPackageXMLPath(options, sharedContext.tmpdir2))
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
                log.verbose(`Removing line ${lineNoResult1[0].number} in package.xml from org1`)
                promises.push(lineRemove(utils.getPackageXMLPath(options, sharedContext.tmpdir1), lineNoResult1[0].number))
            }
            if (lineNoResult2 && lineNoResult2.length === 1) {
                log.verbose(`Removing line ${lineNoResult2[0].number} in package.xml from org2`)
                promises.push(lineRemove(utils.getPackageXMLPath(options, sharedContext.tmpdir2), lineNoResult2[0].number))
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
    log.verbose('Starting to compare file contents')
    const changes = diff.diffTrimmedLines(fileContents[0], fileContents[1])
    
    // filter out any parts that doesn't have a change or addition
    const filteredChanges = changes.filter(part => part.hasOwnProperty('changed') || part.hasOwnProperty('added'))
    if (options.verbose) {
        log.verbose(`Here are the diff parts between the two files (<${filteredChanges.length}> elements)`)
        filteredChanges.forEach(part => {
            log.verbose(`- ${JSON.stringify(part, 2, undefined)}`)
        })
    }

    const rc = filteredChanges.length ? 1 : 0
    if (filteredChanges.length) {
        log.info('!! THERE ARE DIFFERENCES BETWEEN THE FILES !!')
        filteredChanges.forEach((part) => {
            log.info(`${part.added ? 'ADDED' : 'REMOVED'}: ${part.value.trim()}`)
        })

    } else {
        log.info('The files are the same')
    }

    return Promise.resolve(rc)

}).then(rc => {
    if (options['save-packagexml'] && ('always' === options['save-packagexml']) || ('diff' === options['save-packagexml'] && rc === 1)) {
        log.info('Saving compared package.xml files')
        
        return Promise.all([
            Promise.resolve(rc),
            fsutil.copyFile(utils.getPackageXMLPath(options, sharedContext.tmpdir1), path.join(options['save-dir'], `package-1-${utils.getTimestamp()}.xml`)),
            fsutil.copyFile(utils.getPackageXMLPath(options, sharedContext.tmpdir2), path.join(options['save-dir'], `package-2-${utils.getTimestamp()}.xml`))
        ])

    } else {
        return Promise.resolve(rc)
    }

}).then(rc => {
    // exit
    log.verbose(`Exiting script with exit code ${Array.isArray(rc) ? rc[0] : rc}`)
    return process.exit(rc)

}).catch(err => {
    log.error('Unable to complete operation', err)
    process.exit(1)
})
