/*
 * VK Video — плагин для Lampa. Сборка содержит встроенный QR-генератор:
 * QR Code Generator for JavaScript (c) 2009 Kazuhiko Arase, MIT license.
 */

//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

/*
 * VK Video — чистые функции без зависимостей от Lampa.
 * Используются и в плагине, и в автотестах (tests/run-tests.js).
 */

var VKU = (function () {
    'use strict';

    var QUALITY_ORDER = ['mp4_2160', 'mp4_1440', 'mp4_1080', 'mp4_720', 'mp4_480', 'mp4_360', 'mp4_240'];
    var QUALITY_LABEL = { mp4_2160: '2160p', mp4_1440: '1440p', mp4_1080: '1080p', mp4_720: '720p', mp4_480: '480p', mp4_360: '360p', mp4_240: '240p' };

    function fmtDuration(sec) {
        sec = Math.max(0, sec | 0);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h ? h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2)
                 : m + ':' + ('0' + s).slice(-2);
    }

    function pickImage(video) {
        if (video && video.image && video.image.length) {
            return video.image[video.image.length - 1].url;
        }
        return (video && (video.__img || video.photo_640 || video.photo_320 || video.photo_130)) || '';
    }

    function videoKey(v) {
        return 'vk:' + v.owner_id + '_' + v.id;
    }

    function pageUrl(v) {
        return 'https://vkvideo.ru/video' + v.owner_id + '_' + v.id;
    }

    // Карта качеств для меню плеера: только mp4-качества не выше cap (число пикселей)
    function qualityMap(files, cap) {
        var map = {};
        cap = cap || 9999;
        QUALITY_ORDER.forEach(function (f) {
            var h = parseInt(f.replace('mp4_', ''), 10);
            if (files && files[f] && h <= cap) {
                map[QUALITY_LABEL[f]] = files[f];
            }
        });
        return map;
    }

    // Лучшее (максимальное по числу) качество из карты
    function bestInMap(map) {
        var best = null, bestH = -1;
        for (var label in map) {
            var h = parseInt(label, 10);
            if (h > bestH) { bestH = h; best = map[label]; }
        }
        return best;
    }

    // Второе по качеству — запасная ссылка для плеера
    function reserveInMap(map) {
        var bestLabel = null, bestH = -1;
        for (var label in map) {
            var h = parseInt(label, 10);
            if (h > bestH) { bestH = h; bestLabel = label; }
        }
        var second = null, secondH = -1;
        for (var l2 in map) {
            var h2 = parseInt(l2, 10);
            if (l2 !== bestLabel && h2 > secondH) { secondH = h2; second = map[l2]; }
        }
        return second;
    }

    // Разбор ссылок VK. Поддержка: vk.com, vk.ru, vkvideo.ru, vk.me;
    // форматы /video<oid>_<id>[_<key>], /clip..., ?z=video..., video_ext.php?oid=&id=&hash=
    function parseVkVideoLink(rawUrl) {
        var url = (rawUrl || '').trim();
        if (!url) return null;
        var host = (url.split('/')[2] || '').toLowerCase();
        if (!/(^|\.)(vk\.com|vk\.ru|vkvideo\.ru|vk\.me)$/.test(host)) return null;

        var m;

        // video_ext.php?oid=-123&id=456&hash=abc
        if (/video_ext\.php/i.test(url)) {
            var oid = (url.match(/oid=(-?\d+)/) || [])[1];
            var id = (url.match(/[^a-z]id=(\d+)/i) || [])[1];
            var hash = (url.match(/hash=([\w]+)/) || [])[1];
            if (oid && id) return { owner_id: +oid, id: +id, access_key: hash || '' };
            return null;
        }

        // vk.com/video?z=video-123_456%2F...
        m = url.match(/[?&]z=([^&]+)/);
        if (m) {
            var z = decodeURIComponent(m[1]);
            var mm = z.match(/(?:video|clip)(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
            if (mm) return { owner_id: +mm[1], id: +mm[2], access_key: mm[3] || '' };
        }

        // vkvideo.ru/video-123_456_abc / vk.com/video123_456 / clip-123_456
        m = url.match(/(?:video|clip)(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
        if (m) return { owner_id: +m[1], id: +m[2], access_key: m[3] || '' };

        return null;
    }

    // Сравнение версий вида '1.2.10' vs '1.3.0' → true если вторая новее
    function versionNewer(a, b) {
        var pa = String(a || '').split('.');
        var pb = String(b || '').split('.');
        for (var i = 0; i < 3; i++) {
            var x = parseInt(pa[i] || '0', 10);
            var y = parseInt(pb[i] || '0', 10);
            if (y > x) return true;
            if (y < x) return false;
        }
        return false;
    }

    return {
        QUALITY_ORDER: QUALITY_ORDER,
        QUALITY_LABEL: QUALITY_LABEL,
        fmtDuration: fmtDuration,
        pickImage: pickImage,
        videoKey: videoKey,
        pageUrl: pageUrl,
        qualityMap: qualityMap,
        bestInMap: bestInMap,
        reserveInMap: reserveInMap,
        parseVkVideoLink: parseVkVideoLink,
        versionNewer: versionNewer
    };
})();

// Автотесты в Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VKU;
}

/*
 * VK Video — плагин для Lampa (lampa.cub.red)
 *
 * Личный аккаунт ВКонтакте в Lampa: каталог, альбомы, сообщества, поиск,
 * продолжение просмотра, выбор качества и скорости, избранное, авто-next,
 * открытие по ссылке, скачивание разрешённых видео.
 *
 * Сборка: build.sh -> vk-video.js (src-utils.js + src-plugin.js + vendor/qrcode-lib.js).
 */

(function () {
    'use strict';

    var GUARD = 'vk_video_plugin_loaded';
    var VERSION = '1.3.1';
    var UPDATE_URL = 'https://shangri0la.github.io/vk-lampa-plugin/version.json';

    var API = 'https://api.vk.com/method/';
    var API_V = '5.199';
    var PAGE_SIZE = 50;
    var THROTTLE_MS = 360;      // user-token лимит VK ≈ 3 req/s
    var REQUEST_TIMEOUT = 20000;
    var RESOLVE_TTL = 20 * 60 * 1000; // подписанные CDN-ссылки живут часами; кэш на 20 минут

    // Публичное standalone-приложение по умолчанию. VK последовательно заблокировал
    // известные публичные app_id (Kate Mobile 2685278 «Access denied [15]», VK Me,
    // VK Admin, VK Android и ещё ~20 — все «application is blocked»).
    // На 14.11.2026 живым остаётся Square Fit (6885762) — страница входа открывается.
    // Если VK закроет и его — в настройках есть поле «VK App ID» для своего приложения.
    var AUTH_APP_ID = '6885762';

    function authAppId() {
        // Storage.get может вернуть число для числовой строки — поэтому String()
        var v = '';
        try { v = String(Lampa.Storage.get('vk_video_appid', '') || '').trim(); } catch (e) {}
        if (!v) {
            try { v = String(Lampa.Storage.field('vk_video_appid') || '').trim(); } catch (e) {}
        }
        return v || AUTH_APP_ID;
    }

    function buildAuthUrl(withGroups) {
        var scope = withGroups ? 'video,groups,offline' : 'video,offline';
        return 'https://oauth.vk.com/authorize?client_id=' + authAppId() +
            '&display=page&scope=' + scope + '&response_type=token&v=' + API_V;
    }

    // ------------------------------------------------------------------
    // Сеть: VK API с троттлингом, таймаутом и понятными ошибками
    // ------------------------------------------------------------------

    var lastCall = 0;
    var queue = [];
    var queueBusy = false;

    function vkErrorMessage(err) {
        var code = err && err.error_code;
        var msg = (err && err.error_msg) || 'Неизвестная ошибка VK API';
        if (code === 5) return 'Токен VK недействителен или истёк. Откройте раздел VK Video и подключите аккаунт заново.';
        if (code === 6) return 'Слишком много запросов к VK. Подождите пару секунд и повторите.';
        if (code === 7) return 'VK: недостаточно прав для этого действия.';
        if (code === 15) return 'VK: нет доступа к этому видео.';
        if (code === 100) return 'VK: неверные параметры запроса.';
        if (code === 600) return 'VK: нет доступа к видеозаписям.';
        return 'VK: ' + msg;
    }

    function apiCall(method, params, success, fail) {
        var token = getToken();
        if (!token) {
            fail('Токен VK не задан. Откройте раздел VK Video и подключите аккаунт.');
            return;
        }
        var qs = [];
        for (var k in params) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
                qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            }
        }
        qs.push('access_token=' + encodeURIComponent(token));
        qs.push('v=' + API_V);
        queue.push({ url: API + method + '?' + qs.join('&'), success: success, fail: fail, done: false });
        runQueue();
    }

    function finishTask(task, fn, arg) {
        if (task.done) return;
        task.done = true;
        fn(arg);
    }

    function runQueue() {
        if (queueBusy || !queue.length) return;
        queueBusy = true;
        var task = queue.shift();
        var wait = Math.max(0, THROTTLE_MS - (Date.now() - lastCall));
        setTimeout(function () {
            lastCall = Date.now();
            var killer = setTimeout(function () {
                finishTask(task, task.fail, 'VK не отвечает (превышено время ожидания).');
            }, REQUEST_TIMEOUT);
            Lampa.Network.silent(task.url, function (json) {
                clearTimeout(killer);
                queueBusy = false;
                runQueue();
                if (json && json.error) {
                    finishTask(task, task.fail, vkErrorMessage(json.error));
                    return;
                }
                finishTask(task, task.success, (json && json.response) || {});
            }, function () {
                clearTimeout(killer);
                queueBusy = false;
                runQueue();
                finishTask(task, task.fail, 'Нет соединения с api.vk.com.');
            });
        }, wait);
    }

    function getToken() {
        try {
            return String(Lampa.Storage.field('vk_video_token') || '').trim();
        } catch (e) {
            return String(Lampa.Storage.get('vk_video_token', '') || '').trim();
        }
    }

    // ------------------------------------------------------------------
    // Локальные списки: история просмотра, избранное, кэш каталога
    // ------------------------------------------------------------------

    function historyList() {
        return Lampa.Storage.get('vk_video_history', []) || [];
    }

    function historyFind(key) {
        var list = historyList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return list[i];
        }
        return null;
    }

    function historySave(key, title, timeSec, durationSec) {
        if (!durationSec || durationSec < 30) return;
        var list = historyList().filter(function (h) { return h.key !== key; });
        list.unshift({ key: key, title: title, time: Math.floor(timeSec || 0), duration: Math.floor(durationSec), date: Date.now() });
        Lampa.Storage.set('vk_video_history', list.slice(0, 50));
    }

    function favoritesList() {
        return Lampa.Storage.get('vk_video_favorites', []) || [];
    }

    function favoritesHas(item) {
        var key = VKU.videoKey(item);
        return favoritesList().some(function (f) { return f.key === key; });
    }

    function favoritesToggle(video) {
        var key = VKU.videoKey(video);
        if (favoritesHas(video)) {
            var without = favoritesList().filter(function (f) { return f.key !== key; });
            Lampa.Storage.set('vk_video_favorites', without.slice(0, 100));
            return false;
        }
        var list = favoritesList();
        list.unshift({
            key: key,
            owner_id: video.owner_id,
            id: video.id,
            access_key: video.access_key || '',
            title: video.title || 'Видео',
            duration: video.duration || 0,
            views: video.views || 0,
            __img: VKU.pickImage(video),
            date: Date.now()
        });
        Lampa.Storage.set('vk_video_favorites', list.slice(0, 100));
        return true;
    }

    function cacheGet(key) {
        return Lampa.Storage.get(key, null);
    }

    function cacheSet(key, val) {
        Lampa.Storage.set(key, val);
    }

    // ------------------------------------------------------------------
    // Кэш разрешённых ссылок (в памяти, 20 минут)
    // ------------------------------------------------------------------

    var resolveCache = {};

    function resolveVideo(item, cb, fail) {
        var key = VKU.videoKey(item);
        var hit = resolveCache[key];
        if (hit && Date.now() - hit.ts < RESOLVE_TTL) { cb(hit.video); return; }

        var videosParam = item.owner_id + '_' + item.id + (item.access_key ? '_' + item.access_key : '');
        apiCall('video.get', { videos: videosParam, extended: 1 }, function (res) {
            var video = res.items && res.items[0];
            if (!video) { fail('Видео недоступно.'); return; }
            video.access_key = item.access_key || video.access_key || '';
            resolveCache[key] = { ts: Date.now(), video: video };
            cb(video);
        }, fail);
    }

    // ------------------------------------------------------------------
    // Плеер: качества, скорость, авто-next, прогресс
    // ------------------------------------------------------------------

    function maxQualitySetting() {
        try {
            var q = Lampa.Storage.field('vk_video_quality') || 'auto';
            return q === 'auto' ? 9999 : parseInt(q, 10);
        } catch (e) {
            return 9999;
        }
    }

    function playbackRateSetting() {
        try {
            var r = parseFloat(Lampa.Storage.field('vk_video_rate') || '1');
            return r > 0 ? r : 1;
        } catch (e) {
            return 1;
        }
    }

    function autoNextEnabled() {
        try {
            var v = Lampa.Storage.field('vk_video_autonext');
            return v === undefined || v === null || v === true || v === '1' || v === 'true';
        } catch (e) {
            return true;
        }
    }

    var playQueue = [];
    var playerHooked = false;

    function setPlayQueue(items, startIndex) {
        playQueue = items.slice(startIndex + 1).map(function (v) {
            return { owner_id: v.owner_id, id: v.id, access_key: v.access_key || '', title: v.title };
        });
    }

    function hookPlayer() {
        if (playerHooked) return;
        playerHooked = true;

        var onEnded = function () {
            if (!autoNextEnabled() || !playQueue.length) return;
            var next = playQueue.shift();
            Lampa.Noty.show('Далее: ' + (next.title || 'следующее видео'));
            setTimeout(function () { playVideo(next); }, 500);
        };

        var findVideoEl = function () {
            try {
                var root = Lampa.Player.render && Lampa.Player.render();
                return (root && root.find('video')[0]) || document.querySelector('video');
            } catch (e) {
                return document.querySelector('video');
            }
        };

        Lampa.Player.listener.follow('start', function () {
            setTimeout(function () {
                var el = findVideoEl();
                if (!el) return;
                try { el.playbackRate = playbackRateSetting(); } catch (e) {}
                if (!el.__vk_next_hook) {
                    el.__vk_next_hook = true;
                    el.addEventListener('ended', onEnded);
                }
            }, 700);
        });

        Lampa.Player.listener.follow('destroy', function () {
            playQueue = [];
            stopProgressMonitor();
        });
    }

    var progressTimer = null;

    function startProgressMonitor(key, title) {
        stopProgressMonitor();
        progressTimer = setInterval(function () {
            try {
                if (!(Lampa.Player.opened && Lampa.Player.opened())) { stopProgressMonitor(); return; }
                var el = document.querySelector('video');
                if (el && el.duration > 0) {
                    historySave(key, title, el.currentTime, el.duration);
                }
            } catch (e) {}
        }, 4000);
    }

    function stopProgressMonitor() {
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    }

    // ------------------------------------------------------------------
    // Воспроизведение
    // ------------------------------------------------------------------

    function resumeTime(item) {
        var h = historyFind(VKU.videoKey(item));
        if (h && h.duration > 0) {
            var pct = h.time / h.duration;
            if (pct > 0.03 && pct < 0.95) return h.time;
        }
        return 0;
    }

    function playVideo(item, opts) {
        opts = opts || {};
        var key = VKU.videoKey(item);
        hookPlayer();
        if (!opts.silent) Lampa.Noty.show('Получаем ссылку на видео…');

        resolveVideo(item, function (video) {
            var map = VKU.qualityMap(video.files, maxQualitySetting());
            var url = VKU.bestInMap(map);
            var reserve = VKU.reserveInMap(map);

            var title = video.title || item.title || 'VK Video';
            var time = opts.startOver ? 0 : resumeTime(item);

            setPlayQueue([video], 0);

            if (url) {
                Lampa.Player.play({
                    title: title,
                    url: url,
                    quality: Object.keys(map).length > 1 ? map : undefined,
                    url_reserve: reserve || undefined,
                    timeline: time > 0 ? { time: time } : undefined
                });
                startProgressMonitor(key, title);
            } else {
                stopProgressMonitor();
                playViaIframe(video);
            }
        }, function (msg) {
            Lampa.Noty.show(msg);
        });
    }

    function playViaIframe(video) {
        var player = (video && (video.player || (video.files && video.files.external))) || '';
        if (!player) {
            Lampa.Noty.show('У этого видео нет доступного источника для просмотра.');
            return;
        }
        player += (player.indexOf('?') > -1 ? '&' : '?') + 'autoplay=1&hd=2';
        var html =
            '<div style="position:relative;width:100%;height:100%;">' +
            '<iframe src="' + player + '" ' +
            'allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;" ' +
            'frameborder="0" allowfullscreen ' +
            'style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"></iframe>' +
            '</div>';
        Lampa.Modal.open({
            title: video.title || 'VK Video',
            html: $('<div style="width:64vw;height:36vw;"></div>').append(html),
            size: 'full',
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('content');
            }
        });
    }

    // Скачивание: только то, что VK сам разрешил (can_download)
    function downloadVideo(video) {
        resolveVideo(video, function (fresh) {
            if (!fresh.can_download) {
                Lampa.Noty.show('VK не разрешает скачивать это видео.');
                return;
            }
            var map = VKU.qualityMap(fresh.files, maxQualitySetting());
            var url = VKU.bestInMap(map);
            if (!url) { Lampa.Noty.show('Прямой файл недоступен.'); return; }
            var w = window.open(url, '_blank');
            if (!w) {
                Lampa.Utils.copyTextToClipboard(url, function () {
                    Lampa.Noty.show('Ссылка на файл скопирована — откройте её в браузере.');
                }, function () {
                    Lampa.Noty.show('Не удалось открыть ссылку на файл.');
                });
            }
        }, function (msg) {
            Lampa.Noty.show(msg);
        });
    }

    // ------------------------------------------------------------------
    // Меню карточки (долгое нажатие)
    // ------------------------------------------------------------------

    function openCardMenu(video) {
        var inFav = favoritesHas(video);
        var items = [
            {
                title: 'Смотреть',
                subtitle: 'с места, где остановились',
                onSelect: function () { playVideo(video); }
            },
            {
                title: 'Смотреть сначала',
                subtitle: 'с самого начала',
                onSelect: function () { playVideo(video, { startOver: true }); }
            },
            {
                title: inFav ? 'Убрать из избранного' : '★ В избранное',
                subtitle: 'локальный список на этом устройстве',
                onSelect: function () {
                    var added = favoritesToggle(video);
                    Lampa.Noty.show(added ? 'Добавлено в избранное.' : 'Убрано из избранного.');
                }
            },
            {
                title: 'Скопировать ссылку',
                subtitle: 'ссылка на страницу видео VK',
                onSelect: function () {
                    Lampa.Utils.copyTextToClipboard(VKU.pageUrl(video), function () {
                        Lampa.Noty.show('Ссылка скопирована.');
                    }, function () {
                        Lampa.Noty.show('Не удалось скопировать.');
                    });
                }
            }
        ];
        if (video.can_download) {
            items.push({
                title: '⬇ Скачать',
                subtitle: 'VK разрешает скачивание этого видео',
                onSelect: function () { downloadVideo(video); }
            });
        }
        Lampa.Select.show({
            title: video.title || 'VK Видео',
            items: items,
            onBack: function () {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ------------------------------------------------------------------
    // Владелец (автоопределение по токену)
    // ------------------------------------------------------------------

    var ownerCache = null;

    function resolveOwner(cb) {
        if (ownerCache) { cb(ownerCache); return; }
        var cached = Lampa.Storage.get('vk_video_owner', null);
        var token = getToken();
        if (cached && token && cached.token === token) {
            ownerCache = { id: cached.id, name: cached.name };
            cb(ownerCache);
            return;
        }
        apiCall('users.get', {}, function (res) {
            var user = res && res[0];
            if (!user || !user.id) { cb(null); return; }
            ownerCache = { id: user.id, name: user.first_name + ' ' + user.last_name };
            Lampa.Storage.set('vk_video_owner', { id: ownerCache.id, name: ownerCache.name, token: token });
            cb(ownerCache);
        }, function (msg) {
            Lampa.Noty.show(msg);
            cb(null);
        });
    }

    // ------------------------------------------------------------------
    // Экран подключения (авторизация внутри Lampa)
    // ------------------------------------------------------------------

    var AUTH_STEPS =
        '1. Нажмите «Войти через VK» или отсканируйте QR-код телефоном.\n' +
        '2. На странице VK войдите (можно по QR — без пароля) и нажмите «Разрешить».\n' +
        '3. Скопируйте access_token из адресной строки браузера (между access_token= и &expires_in).\n' +
        '4. Вернитесь сюда и нажмите «Ввести токен».\n' +
        'Есть ссылка на видео VK? Кнопка «Открыть по ссылке» её разберёт.';

    function verifyAndSaveToken(token, onOk, onFail) {
        token = (token || '').trim();
        if (!token) { onFail('Токен пустой.'); return; }
        Lampa.Storage.set('vk_video_token', token);
        ownerCache = null;
        apiCall('users.get', {}, function (res) {
            var user = res && res[0];
            if (!user || !user.id) {
                Lampa.Storage.set('vk_video_token', '');
                onFail('VK не принял токен. Проверьте, что скопировали его целиком.');
                return;
            }
            ownerCache = { id: user.id, name: user.first_name + ' ' + user.last_name };
            Lampa.Storage.set('vk_video_owner', { id: ownerCache.id, name: ownerCache.name, token: token });
            onOk(ownerCache);
        }, function (msg) {
            Lampa.Storage.set('vk_video_token', '');
            onFail(msg);
        });
    }

    function openTokenInput(onConnected) {
        var kbParams = {
            title: 'VK Access Token',
            value: getToken(),
            free: true,
            nosave: true,
            nomic: true,
            keyboard: 'simple'
        };
        Lampa.Input.edit(kbParams, function (value) {
            verifyAndSaveToken(value, function (owner) {
                Lampa.Noty.show('Подключено: ' + owner.name);
                onConnected();
            }, function (msg) {
                Lampa.Noty.show(msg);
            });
        });
    }

    function openByLinkInput(onFound) {
        Lampa.Input.edit({
            title: 'Ссылка на видео VK',
            value: '',
            free: true,
            nosave: true,
            nomic: true,
            keyboard: 'simple'
        }, function (value) {
            var parsed = VKU.parseVkVideoLink(value);
            if (!parsed) {
                Lampa.Noty.show('Не распознали ссылку. Поддерживаются vk.com, vk.ru, vkvideo.ru.');
                return;
            }
            onFound(parsed);
        });
    }

    function buildAuthPanel(onConnected, withGroups) {
        // ссылка считается в момент нажатия — чтобы подхватить свежий App ID из настроек
        var currentUrl = function () { return buildAuthUrl(withGroups); };
        var extra = withGroups
            ? '<div style="margin-top:.5em;color:#7fb2ff;">Права сообществ включены: после входа откроются видео ваших групп.</div>'
            : '';
        var panel = $(
            '<div class="vk-auth" style="max-width:640px;margin:0 auto;padding:2em 1.5em;">' +
            '<div style="font-size:1.4em;margin-bottom:.4em;">VK Видео — подключение аккаунта</div>' +
            '<div style="opacity:.7;white-space:pre-line;line-height:1.5;">' + AUTH_STEPS + '</div>' + extra +
            '<div class="vk-auth__qr" style="margin:1.2em 0;text-align:center;"></div>' +
            '<div class="vk-auth__buttons" style="display:flex;flex-direction:column;gap:8px;">' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Войти через VK (открыть страницу)</div>' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Скопировать ссылку для входа</div>' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Открыть видео по ссылке</div>' +
            '<div class="vk-auth__btn selector" style="background:#0077FF;border-radius:8px;padding:.8em;text-align:center;">Ввести токен</div>' +
            '</div>' +
            '</div>'
        );

        try {
            if (typeof qrcode === 'function') {
                var qr = qrcode(0, 'M');
                qr.addData(currentUrl());
                qr.make();
                panel.find('.vk-auth__qr').append(qr.createImgTag(4, 8));
            }
        } catch (e) {}

        var buttons = panel.find('.vk-auth__btn');
        buttons.eq(0).on('hover:enter', function () {
            var w = window.open(currentUrl(), '_blank');
            if (!w) Lampa.Noty.show('Браузер заблокировал открытие. Используйте ссылку или QR-код.');
        });
        buttons.eq(1).on('hover:enter', function () {
            Lampa.Utils.copyTextToClipboard(currentUrl(), function () {
                Lampa.Noty.show('Ссылка скопирована. Откройте её на любом устройстве.');
            }, function () {
                Lampa.Noty.show('Не удалось скопировать. Отсканируйте QR-код телефоном.');
            });
        });
        buttons.eq(2).on('hover:enter', function () {
            openByLinkInput(function (parsed) {
                if (!getToken()) {
                    Lampa.Noty.show('Сначала подключите аккаунт — для приватных видео нужен токен.');
                    return;
                }
                playVideo(parsed);
            });
        });
        buttons.eq(3).on('hover:enter', function () {
            openTokenInput(onConnected);
        });

        return panel;
    }

    // ------------------------------------------------------------------
    // Карточки
    // ------------------------------------------------------------------

    Lampa.Template.add('vk_video_card', [
        '<div class="video__card selector">',
        '<div class="video__imgbox">',
        '<img class="video__img" alt="">',
        '<div class="video__duration" style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:4px;font-size:.85em;">{duration}</div>',
        '{badge}',
        '</div>',
        '<div class="video__title" style="margin-top:6px;font-size:1em;line-height:1.3;overflow:hidden;">{title}</div>',
        '<div class="video__views" style="opacity:.6;font-size:.85em;">{views}</div>',
        '</div>'
    ].join(''));

    Lampa.Template.add('vk_video_album', [
        '<div class="video__card selector">',
        '<div class="video__imgbox" style="display:flex;align-items:center;justify-content:center;height:110px;background:rgba(255,255,255,.06);border-radius:8px;">',
        '<div style="font-size:2.2em;">📁</div>',
        '</div>',
        '<div class="video__title" style="margin-top:6px;">{title}</div>',
        '<div class="video__views">{count}</div>',
        '</div>'
    ].join(''));

    Lampa.Template.add('vk_video_group', [
        '<div class="video__card selector">',
        '<div class="video__imgbox" style="display:flex;align-items:center;justify-content:center;height:110px;background:rgba(255,255,255,.06);border-radius:8px;">',
        '<img style="max-width:70px;max-height:70px;border-radius:12px;" src="{img}">',
        '</div>',
        '<div class="video__title" style="margin-top:6px;">{title}</div>',
        '<div class="video__views">{count}</div>',
        '</div>'
    ].join(''));

    function resumeBadge(video) {
        var h = historyFind(VKU.videoKey(video));
        if (h && h.duration > 0) {
            var pct = Math.round(100 * h.time / h.duration);
            if (pct >= 3 && pct < 95) return '<div style="position:absolute;left:6px;top:6px;background:#0077FF;padding:2px 5px;border-radius:4px;font-size:.8em;">просмотрено ' + pct + '%</div>';
            if (pct >= 95) return '<div style="position:absolute;left:6px;top:6px;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:4px;font-size:.8em;">✓</div>';
        }
        return '';
    }

    function buildCard(video) {
        var card = Lampa.Template.get('vk_video_card', {
            title: Lampa.Utils.shortText(video.title || 'Без названия', 60),
            duration: VKU.fmtDuration(video.duration),
            views: 'Просмотры: ' + (video.views || 0),
            badge: resumeBadge(video)
        });
        var img = card.find('.video__img')[0];
        if (img) img.src = VKU.pickImage(video);
        card.on('hover:enter', function () { playVideo(video); });
        card.on('hover:long', function () { openCardMenu(video); });
        return card;
    }

    // ------------------------------------------------------------------
    // Базовый экран: скролл, пагинация, кэш, ошибки с повтором
    // ------------------------------------------------------------------

    function VkScreen(object) {
        this.data = object;
        this.items = [];
        this.offset = 0;
        this.total = Infinity;
        this.loading = false;
    }

    VkScreen.prototype.create = function () {
        this.html = $('<div class="vk-video-screen" style="width:100%;"></div>');
        this.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.scroll.append(this.body = $('<div class="vk-video-grid" style="display:flex;flex-wrap:wrap;gap:12px;padding:1.5em;"></div>'));
        this.html.append(this.scroll.render());
        if (!getToken()) {
            this.showAuth();
        } else {
            this.bootstrap();
        }
        return this.html;
    };

    VkScreen.prototype.render = function () { return this.html; };

    VkScreen.prototype.showAuth = function (withGroups) {
        this.authMode = true;
        var self = this;
        this.body.empty();
        this.body.append(buildAuthPanel(function () {
            // экран пересоздаётся целиком: появятся действия, «недавно» и каталог
            self.authMode = false;
            if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
            else { self.body.empty(); self.bootstrap(); }
        }, withGroups));
    };

    VkScreen.prototype.bootstrap = function () {
        var self = this;
        var cacheKey = this.cacheKey();
        var cached = cacheKey ? cacheGet(cacheKey) : null;
        if (cached && cached.items && cached.items.length) {
            this.total = cached.total || Infinity;
            this.renderItems(cached.items, true);
            this.offset = cached.items.length;
            setTimeout(function () { self.nextPage(true); }, 300);
        } else {
            this.loader();
            this.nextPage();
        }
    };

    VkScreen.prototype.loader = function () {
        var l = $('<div style="padding:1.5em;opacity:.6;">Загрузка…</div>');
        this.body.append(l);
        this._loadingEl = l;
    };

    VkScreen.prototype.removeLoader = function () {
        if (this._loadingEl) { this._loadingEl.remove(); this._loadingEl = null; }
    };

    // Ошибка + «Повторить»; наследники могут переопределить (сообщества — доп. кнопка)
    VkScreen.prototype.showError = function (msg) {
        var self = this;
        var err = $('<div class="vk-error" style="padding:1.5em;">' + msg +
            '<div class="vk-error__retry selector" style="display:inline-block;margin-top:1em;background:rgba(255,255,255,.1);border-radius:8px;padding:.7em 1.5em;">Повторить</div></div>');
        err.find('.vk-error__retry').on('hover:enter', function () {
            err.remove();
            self.loader();
            self.nextPage();
        });
        this.body.append(err);
    };

    VkScreen.prototype.renderItems = function (items, fromCache) {
        var self = this;
        items.forEach(function (item) {
            if (fromCache && self.items.some(function (x) { return VKU.videoKey(x) === VKU.videoKey(item); })) return;
            var el = self.buildItemEl(item);
            self.body.append(el);
            self.items.push(item);
        });
    };

    // переопределяется наследниками
    VkScreen.prototype.fetch = function (cb, fail) { cb([], 0); };
    VkScreen.prototype.buildItemEl = function (item) {
        var el = this.cardFor(item);
        var self = this;
        el.on('hover:enter', function () { self.onItem(item, el); });
        return el;
    };
    VkScreen.prototype.cardFor = function (item) { return buildCard(item); };
    VkScreen.prototype.onItem = function (item) {};
    VkScreen.prototype.cacheKey = function () { return null; };
    VkScreen.prototype.sortItems = null; // 'date'|'title'|'duration' или null

    VkScreen.prototype.nextPage = function (silent) {
        var self = this;
        if (this.loading || this.offset >= this.total) return;
        this.loading = true;
        if (!silent) this.removeLoader();
        this.fetch(function (items, total) {
            self.loading = false;
            self.removeLoader();
            self.total = total;
            self.renderItems(items, false);
            self.offset = self.items.length;
            if (!self.items.length) {
                self.body.append('<div style="padding:1.5em;opacity:.6;">Пока нет видео здесь.</div>');
            }
        }, function (msg) {
            self.loading = false;
            self.removeLoader();
            if (!self.items.length) {
                self.showError(msg);
            } else {
                Lampa.Noty.show(msg);
            }
        });
    };

    // Локальная пересортировка уже показанных карточек
    VkScreen.prototype.resortGrid = function () {
        if (!this.sortItems || !this.items.length) return;
        var sort = this.sortItems;
        var sorted = this.items.slice().sort(function (a, b) {
            if (sort === 'title') return (a.title || '').localeCompare(b.title || '', 'ru');
            if (sort === 'duration') return (b.duration || 0) - (a.duration || 0);
            return 0; // date: VK уже отдаёт новые первыми
        });
        this.body.children().remove();
        this.items = [];
        this.renderItems(sorted, false);
    };

    VkScreen.prototype.start = function () {
        var self = this;
        Lampa.Controller.add('vk_video_content', {
            toggle: function () {
                if (!self.body || !self.body[0]) return;
                var els = (self.authMode || self.body.find('.vk-error').length)
                    ? self.body.find('.selector')
                    : self.body.children();
                try {
                    Lampa.Controller.collectionSet(els);
                    Lampa.Controller.collectionFocus(false, self.body[0]);
                } catch (e) {}
            },
            up: function () { if (Lampa.Controller.move) Lampa.Controller.move('up'); },
            down: function () { if (Lampa.Controller.move) Lampa.Controller.move('down'); },
            right: function () { if (Lampa.Controller.move) Lampa.Controller.move('right'); },
            left: function () { if (Lampa.Controller.move) Lampa.Controller.move('left'); },
            back: function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('vk_video_content');
        this.scroll.onEnd = function () { self.nextPage(); };
    };

    VkScreen.prototype.pause = function () {};
    VkScreen.prototype.stop = function () {};
    VkScreen.prototype.destroy = function () {
        this.html.remove();
        if (this.scroll && this.scroll.destroy) this.scroll.destroy();
    };

    // Строка действий под шапкой экрана
    VkScreen.prototype.buildActions = function (defs) {
        var html = '<div class="vk-actions" style="display:flex;gap:10px;padding:1.5em 1.5em 0 1.5em;flex-wrap:wrap;">';
        defs.forEach(function (d) {
            html += '<div class="vk-action selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.7em 1.3em;">' + d.title + '</div>';
        });
        html += '</div>';
        var row = $(html);
        row.find('.vk-action').each(function (i) {
            if (defs[i].onEnter) $(this).on('hover:enter', defs[i].onEnter);
        });
        return row;
    };

    // ------------------------------------------------------------------
    // «Мои видео»
    // ------------------------------------------------------------------

    function VideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cacheKey = function () { return 'vk_video_cache_list'; };
        this.sortItems = 'date';
        try { this.sortItems = Lampa.Storage.field('vk_video_sort') || 'date'; } catch (e) {}

        this.addHeaderActions = function () {
            this.html.prepend(this.buildActions([
                {
                    title: '🔍 Поиск',
                    onEnter: function () {
                        Lampa.Input.edit({
                            title: 'Поиск по видео (мои и доступные)',
                            value: '', free: true, nosave: true, nomic: true, keyboard: 'simple'
                        }, function (query) {
                            query = (query || '').trim();
                            if (query) {
                                Lampa.Activity.push({ url: '', title: 'VK: поиск «' + query + '»', component: 'vk_video_search', query: query, page: 1 });
                            }
                        });
                    }
                },
                {
                    title: '★ Избранное',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Избранное', component: 'vk_video_favorites', page: 1 });
                    }
                },
                {
                    title: '📁 Альбомы',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Альбомы', component: 'vk_video_albums', page: 1 });
                    }
                },
                {
                    title: '👥 Сообщества',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Сообщества', component: 'vk_video_communities', page: 1 });
                    }
                },
                {
                    title: '⇅ Сортировка',
                    onEnter: function () {
                        Lampa.Select.show({
                            title: 'Сортировка',
                            items: [
                                { title: 'По дате (новые)', sort: 'date' },
                                { title: 'По названию', sort: 'title' },
                                { title: 'По длительности', sort: 'duration' }
                            ],
                            onSelect: function (a) {
                                Lampa.Storage.set('vk_video_sort', a.sort);
                                self.sortItems = a.sort;
                                self.resortGrid();
                                Lampa.Controller.toggle('vk_video_content');
                            },
                            onBack: function () { Lampa.Controller.toggle('vk_video_content'); }
                        });
                    }
                },
                {
                    title: '🔗 По ссылке',
                    onEnter: function () {
                        openByLinkInput(function (parsed) { playVideo(parsed); });
                    }
                },
                {
                    title: '🔄 Обновить',
                    onEnter: function () {
                        cacheSet('vk_video_cache_list', null);
                        if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
                    }
                }
            ]));
        };

        this.addRecentRow = function () {
            var hist = historyList().slice(0, 12);
            if (!hist.length) return;
            var row = $('<div style="padding:1.5em 1.5em 0 1.5em;"><div style="opacity:.6;margin-bottom:.7em;">Недавно просмотренные</div><div class="vk-recent" style="display:flex;gap:12px;flex-wrap:wrap;"></div></div>');
            hist.forEach(function (h) {
                var pct = Math.round(100 * h.time / (h.duration || 1));
                var el = $('<div class="selector" style="max-width:170px;background:rgba(255,255,255,.05);border-radius:8px;padding:.6em;">' +
                    '<div style="font-size:.9em;line-height:1.3;overflow:hidden;max-height:2.6em;">' + Lampa.Utils.shortText(h.title || 'Видео', 40) + '</div>' +
                    '<div style="opacity:.6;font-size:.8em;margin-top:.3em;">' + VKU.fmtDuration(h.duration) + ' · ' + pct + '%</div></div>');
                el.on('hover:enter', function () {
                    var parts = h.key.replace('vk:', '').split('_');
                    playVideo({ owner_id: +parts[0], id: +parts[1], title: h.title });
                });
                row.find('.vk-recent').append(el);
            });
            this.html.prepend(row);
        };

        this.create = function () {
            VkScreen.prototype.create.call(this);
            if (getToken()) {
                this.addRecentRow();
                this.addHeaderActions();
            }
            return this.html;
        };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK. Проверьте токен.'); return; }
                apiCall('video.get', {
                    owner_id: owner.id,
                    extended: 1,
                    count: PAGE_SIZE,
                    offset: self.offset
                }, function (res) {
                    var items = res.items || [];
                    cb(items, res.count || 0);
                    if (self.offset === 0) {
                        cacheSet('vk_video_cache_list', { items: items, total: res.count || 0 });
                    }
                }, fail);
            });
        };
    }
    VideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Избранное (локальный список)
    // ------------------------------------------------------------------

    function FavoritesScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.fetch = function (cb) {
            var list = favoritesList();
            cb(list, list.length);
        };

        this.create = function () {
            VkScreen.prototype.create.call(this);
            if (getToken() && !favoritesList().length) {
                this.body.append('<div style="padding:1.5em;opacity:.6;">Пусто. Добавляйте видео через долгое нажатие на карточку → «★ В избранное».</div>');
            }
            return this.html;
        };
    }
    FavoritesScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Поиск
    // ------------------------------------------------------------------

    function SearchScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.query = object.query;

        this.fetch = function (cb, fail) {
            apiCall('video.search', {
                q: self.query,
                extended: 1,
                count: PAGE_SIZE,
                offset: self.offset,
                search_global: 0
            }, function (res) {
                cb(res.items || [], res.count || 0);
            }, fail);
        };
    }
    SearchScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Альбомы и видео альбома
    // ------------------------------------------------------------------

    function AlbumsScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cardFor = function (album) {
            return Lampa.Template.get('vk_video_album', {
                title: Lampa.Utils.shortText(album.title || 'Альбом', 60),
                count: (album.count || 0) + ' видео'
            });
        };

        this.onItem = function (album) {
            Lampa.Activity.push({
                url: '',
                title: album.title,
                component: 'vk_video_albums_videos',
                album_id: album.id,
                page: 1
            });
        };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK. Проверьте токен.'); return; }
                apiCall('video.getAlbums', {
                    owner_id: owner.id,
                    count: PAGE_SIZE,
                    offset: self.offset,
                    extended: 1,
                    need_system: 1
                }, function (res) {
                    self.offset += (res.items || []).length;
                    cb(res.items || [], res.count || 0);
                }, fail);
            });
        };
    }
    AlbumsScreen.prototype = Object.create(VkScreen.prototype);

    function AlbumVideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.albumId = object.album_id;

        this.cacheKey = function () { return 'vk_video_cache_album_' + self.albumId; };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK.'); return; }
                apiCall('video.get', {
                    owner_id: owner.id,
                    album_id: self.albumId,
                    extended: 1,
                    count: PAGE_SIZE,
                    offset: self.offset
                }, function (res) {
                    var items = res.items || [];
                    cb(items, res.count || 0);
                    if (self.offset === 0) {
                        cacheSet('vk_video_cache_album_' + self.albumId, { items: items, total: res.count || 0 });
                    }
                }, fail);
            });
        };
    }
    AlbumVideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Сообщества и их видео
    // ------------------------------------------------------------------

    function CommunitiesScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cacheKey = function () { return 'vk_video_cache_communities'; };

        this.cardFor = function (group) {
            return Lampa.Template.get('vk_video_group', {
                title: Lampa.Utils.shortText(group.name || 'Сообщество', 60),
                img: group.photo_200 || group.photo_100 || '',
                count: group.members_count ? group.members_count + ' участников' : ''
            });
        };

        this.onItem = function (group) {
            Lampa.Activity.push({
                url: '',
                title: group.name,
                component: 'vk_video_community_videos',
                group_id: group.id,
                page: 1
            });
        };

        // Не хватило прав (токен без groups) — предлагаем переподключение
        this.showError = function (msg) {
            var self2 = this;
            var err = $('<div class="vk-error" style="padding:1.5em;">' + msg +
                '<div style="margin-top:1em;display:flex;gap:10px;flex-wrap:wrap;">' +
                '<div class="vk-error__retry selector" style="display:inline-block;background:rgba(255,255,255,.1);border-radius:8px;padding:.7em 1.5em;">Повторить</div>' +
                '<div class="vk-error__reauth selector" style="display:inline-block;background:#0077FF;border-radius:8px;padding:.7em 1.5em;">Переподключить с правами сообществ</div>' +
                '</div></div>');
            err.find('.vk-error__retry').on('hover:enter', function () {
                err.remove();
                self2.loader();
                self2.nextPage();
            });
            err.find('.vk-error__reauth').on('hover:enter', function () {
                self2.showAuth(true);
            });
            this.body.append(err);
        };

        this.fetch = function (cb, fail) {
            apiCall('groups.get', {
                extended: 1,
                count: 100,
                offset: self.offset,
                fields: 'members_count,photo_200,photo_100'
            }, function (res) {
                var items = res.items || [];
                cb(items, res.count || 0);
                if (self.offset === 0) {
                    cacheSet('vk_video_cache_communities', { items: items, total: res.count || 0 });
                }
            }, fail);
        };
    }
    CommunitiesScreen.prototype = Object.create(VkScreen.prototype);

    function CommunityVideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.groupId = object.group_id;

        this.cacheKey = function () { return 'vk_video_cache_group_' + self.groupId; };

        this.fetch = function (cb, fail) {
            apiCall('video.get', {
                owner_id: -self.groupId,
                extended: 1,
                count: PAGE_SIZE,
                offset: self.offset
            }, function (res) {
                var items = res.items || [];
                cb(items, res.count || 0);
                if (self.offset === 0) {
                    cacheSet('vk_video_cache_group_' + self.groupId, { items: items, total: res.count || 0 });
                }
            }, fail);
        };
    }
    CommunityVideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Проверка обновлений
    // ------------------------------------------------------------------

    function scheduleUpdateCheck() {
        setTimeout(function () {
            try {
                Lampa.Network.silent(UPDATE_URL + '?v=' + VERSION, function (json) {
                    if (json && json.version && VKU.versionNewer(VERSION, json.version)) {
                        Lampa.Noty.show('VK Video: доступна новая версия ' + json.version + '. Переустановите плагин по своему URL.');
                    }
                }, function () {});
            } catch (e) {}
        }, 45000);
    }

    // ------------------------------------------------------------------
    // Регистрация в Lampa
    // ------------------------------------------------------------------

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.5em;height:1.5em;"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10,8.5 16,12 10,15.5" fill="currentColor" stroke="none"/></svg>';

    function appendMenuItem() {
        if ($('.menu .menu__item--vk-video').length) return;
        var $item = $(
            '<li class="menu__item selector menu__item--vk-video">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">VK Video</div>' +
            '</li>'
        );
        $item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'VK Video — Мои видео',
                component: 'vk_video_main',
                page: 1
            });
        });
        $('.menu .menu__list:eq(0)').append($item);
    }

    function init() {
        if (window[GUARD]) return;
        window[GUARD] = true;

        // Настройки
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addComponent({
                component: 'vk_video_settings',
                name: 'VK Video',
                icon: ICON
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_token', type: 'input', default: '', values: '' },
                field: { name: 'VK Access Token', description: 'Или подключите аккаунт прямо в разделе VK Video' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: {
                    name: 'vk_video_quality',
                    type: 'select',
                    values: { auto: 'Авто (лучшее)', '2160': 'до 4K', '1440': 'до 2K', '1080': 'до 1080p', '720': 'до 720p', '480': 'до 480p', '360': 'до 360p' },
                    default: 'auto'
                },
                field: { name: 'Максимальное качество' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_autonext', type: 'trigger', default: true },
                field: { name: 'Автоматически включать следующее видео' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: {
                    name: 'vk_video_rate',
                    type: 'select',
                    values: { '1': 'Обычная', '1.25': '1.25x', '1.5': '1.5x', '2': '2x' },
                    default: '1'
                },
                field: { name: 'Скорость воспроизведения', description: 'Работает там, где плеер устройства позволяет' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_appid', type: 'input', default: '', values: '' },
                field: { name: 'VK App ID (своё приложение)', description: 'Оставьте пустым, чтобы использовать встроенное. Пригодится, если VK закроет встроенное' },
                onChange: function () {
                    // перерисовать экран подключения — QR и ссылка подхватят новый App ID
                    if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
                }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_version', type: 'input', default: VERSION, values: '' },
                field: { name: 'Версия плагина' }
            });
        }

        // Компоненты экранов
        Lampa.Component.add('vk_video_main', VideosScreen);
        Lampa.Component.add('vk_video_search', SearchScreen);
        Lampa.Component.add('vk_video_favorites', FavoritesScreen);
        Lampa.Component.add('vk_video_albums', AlbumsScreen);
        Lampa.Component.add('vk_video_albums_videos', AlbumVideosScreen);
        Lampa.Component.add('vk_video_communities', CommunitiesScreen);
        Lampa.Component.add('vk_video_community_videos', CommunityVideosScreen);

        // Манифест
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'VK Video',
                description: 'Свои видео из ВКонтакте: каталог, альбомы, сообщества, поиск, продолжение, качества.',
                component: 'vk_video_main'
            };
        } catch (e) {}

        if (window.appready) {
            appendMenuItem();
            scheduleUpdateCheck();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    appendMenuItem();
                    scheduleUpdateCheck();
                }
            });
        }
    }

    init();
})();
