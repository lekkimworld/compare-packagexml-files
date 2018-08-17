/**
 * Simple logger class that simply writes to console.log with a prefix. Verbose logging 
 * can be turned on using the argument to the constructor if the supplied argument 
 * coerses to true.
 * 
 * @param {any} verbose 
 */
function Logger(verbose) {
    this._verbose = verbose
}
Logger.prototype.verbose = function(msg) {
    if (this._verbose) console.log(`VERBOSE - ${msg}`)
}
Logger.prototype.error = function(msg) {
    console.log(`ERROR - ${msg}`)
}
Logger.prototype.info = function(msg) {
    console.log(`INFO - ${msg}`)
}

module.exports = Logger
