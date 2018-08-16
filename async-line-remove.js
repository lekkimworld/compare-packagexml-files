const lineReplace = require('line-replace')

module.exports = (file, line) => {
    return new Promise((resolve, reject) => {
        lineReplace({
            file,
            line,
            'addNewLine': false,
            'text': '',
            'callback': resolve
        })
    })
}
