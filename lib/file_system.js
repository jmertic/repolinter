// Copyright 2017 TODO Group. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const isBinaryFile = require('isbinaryfile')
const path = require('path')
const glob = require('matched')
const fs = require('fs')

/**
 * Utility filesystem class that scopes operations to a given set of directories and a CWD
 *
 * @memberof repolinter
 */
class FileSystem {
  constructor (targetDir = '.', filterPaths = []) {
    this.targetDir = targetDir
    this.filterPaths = filterPaths
  }

  /**
   * Asynchronously checks if a file exists using fs.access
   *
   * @param {string} file An absolute path to verify the existence of
   * @returns {Promise<boolean>} Whether or not the path exists
   */
  static fileExists (file) {
    return fs.promises.access(file, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false)
  }

  /**
   * Asynchronously checks if a file exists using fs.access
   *
   * @param {string} file A path relative to targetDir to check the existence of
   * @returns {Promise<boolean>} Whether or not the path exists
   */
  relativeFileExists (file) {
    return FileSystem.fileExists(path.resolve(this.targetDir, file))
  }

  /**
   * Find the first file or directory matching a list of globs. Globs are
   * searched from first to last. Returns the relative path of that file
   * or directory, or undefined if none was found.
   *
   * @param {string | Array<string>} globs The globs to search with
   * @param {boolean} nocase Whether or not to ignore case-sensitivity
   * @returns {Promise<undefined | string>} A path relative to this.targetDir, or undefined if no items were found
   */
  async findFirst (globs, nocase) {
    const allFiles = await this.findAll(globs, nocase)
    if (allFiles.length > 0) {
      return allFiles[0]
    }
  }

  /**
   * Find the first file matching a list of globs. Globs are
   * searched from first to last. Returns the relative path of that file,
   * or undefined if none was found.
   *
   * @param {string | Array<string>} globs The globs to search with
   * @param {boolean} nocase Whether or not to ignore case-sensitivity
   * @returns {Promise<undefined | string>} A path relative to this.targetDir, or undefined if no items were found
   */
  async findFirstFile (globs, nocase) {
    const allFiles = await this.findAllFiles(globs, nocase)
    if (allFiles.length > 0) {
      return allFiles[0]
    }
  }

  /**
   * Find all files matching a list of globs. Globs are
   * searched from first to last. Returns the relative path of all files,
   * or undefined if none was found. Automatically removes symlinks
   * from results.
   *
   * @param {string | Array<string>} globs The globs to search with
   * @param {boolean} nocase Whether or not to ignore case-sensitivity
   * @returns {Promise<Array<string>>} A list of paths relative to this.targetDir
   */
  async findAllFiles (globs, nocase) {
    const symlinks = {}
    const filePaths = await this.glob(
      globs,
      { cwd: this.targetDir, nocase: !!nocase, nodir: true, symlinks }
    )

    // Make symlinks relative
    const onlySymlinks = {}
    for (const fullPath in symlinks) {
      if (symlinks[fullPath]) {
        const relativeToRepoPath = this.normalizePath(path.relative(this.targetDir, fullPath))
        onlySymlinks[relativeToRepoPath] = true
      }
    }

    // Remove all symlinks
    return filePaths.filter(filePath => !onlySymlinks[this.normalizePath(filePath)])
  }

  async glob (globs, options) {
    const fixedGlobs = typeof globs === 'string' ? this.normalizePath(globs) : globs.map(g => this.normalizePath(g))
    return (await glob(fixedGlobs, options)).map(p => this.normalizePath(p)).filter(p => this.shouldInclude(p))
  }

  /**
   * Find all files or directories matching a list of globs. Globs are
   * searched from first to last. Returns the relative path of all items,
   * or undefined if none was found. Automatically removes symlinks
   * from results.
   *
   * @param {string | Array<string>} globs The globs to search with
   * @param {boolean} [nocase] Whether or not to ignore case-sensitivity
   * @returns {Promise<Array<string>>} A list of paths relative to this.targetDir
   */
  async findAll (globs, nocase = false) {
    const fixedGlobs = typeof globs === 'string' ? this.normalizePath(globs) : globs.map(g => this.normalizePath(g))
    return this.glob(fixedGlobs, { cwd: this.targetDir, nocase: !!nocase })
  }

  async isBinaryFile (relativeFile) {
    const file = path.resolve(this.targetDir, relativeFile)
    try {
      return isBinaryFile.isBinaryFile(file)
    } catch (e) {
      // File doesn't exist or is a directory, so it isn't a binary file
      if (e.message.includes('ENOENT')) {
        return false
      }
      throw e
    }
  }

  shouldInclude (filePath) {
    if (this.filterPaths.length === 0) { return true }
    const resolvedPath = this.normalizePath(path.relative(this.targetDir, path.resolve(this.targetDir, filePath)))
    return this.filterPaths
      .map(p => this.normalizePath(p))
      .some(p => resolvedPath.startsWith(p))
  }

  normalizePath (filepath) {
    if (process.platform === 'win32') {
      return filepath.split(path.sep).join('/')
    } else {
      return filepath
    }
  }

  /**
   * Get the contents of a file in utf8 given a relative path
   *
   * @param {string} relativeFile A path relative to this.targetDir
   * @returns {Promise<string | undefined>} A string with the file contents, or undefined if the file is not found.
   */
  async getFileContents (relativeFile) {
    const file = path.resolve(this.targetDir, relativeFile)
    try {
      return await fs.promises.readFile(file, 'utf8')
    } catch (e) {
      return undefined
    }
  }

  /**
   * Set the contents of a file in utf8 given a relative path and contents.
   *
   * @param {string} relativeFile A path relative to this.targetDir
   * @param {string} contents A string with the file contents
   * @returns {Promise<void>}
   */
  async setFileContents (relativeFile, contents) {
    return fs.promises.writeFile(path.resolve(this.targetDir, relativeFile), contents)
  }

  /**
   * Remove the file at the specified path.
   *
   * @param {string} relativeFile
   * @returns {Promise<void>}
   */
  async removeFile (relativeFile) {
    return fs.promises.unlink(path.resolve(this.targetDir, relativeFile))
  }

  async getFileLines (relativeFile, lineCount) {
    const file = path.resolve(this.targetDir, relativeFile)
    const fs = require('fs')
    let fd
    try {
      fd = await fs.promises.open(path.resolve(this.targetDir, file), 'r')
    } catch (e) {
      if (fd) fd.close()
      // File doesn't exist or is a directory
      if (e.message.includes('ENOENT')) {
        return undefined
      }
      throw e
    }
    var bufferSize = 1024
    var buffer = Buffer.alloc(bufferSize)
    var lines = ''
    var lineNumber = 0

    var leftOver = ''
    var idxStart, idx
    while (true) {
      const ret = await fd.read(buffer, 0, bufferSize, null)
      const read = ret.bytesRead
      if (read === 0) { break }
      leftOver += buffer.toString('utf8', 0, read)
      idxStart = 0
      while ((idx = leftOver.indexOf('\n', idxStart)) !== -1) {
        lineNumber++
        lines += leftOver.substring(idxStart, idx) + '\n'
        idxStart = idx + 1

        if (lineNumber >= lineCount) {
          fd.close()
          return lines
        }
      }
      leftOver = leftOver.substring(idxStart)
    }
    fd.close()
    return lines
  }
}

module.exports = FileSystem
