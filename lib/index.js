/**
 * @typedef {import('vfile').VFile} VFile
 * @typedef {import('property-information').Schema} Schema
 * @typedef {import('unist').Position} Position
 * @typedef {import('unist').Point} Point
 * @typedef {import('hast').Parent} Parent
 * @typedef {import('hast').Element} Element
 * @typedef {import('hast').Root} Root
 * @typedef {import('hast').Text} Text
 * @typedef {import('hast').Comment} Comment
 * @typedef {import('hast').DocType} Doctype
 * @typedef {Parent['children'][number]} Child
 * @typedef {Element['children'][number]} ElementChild
 * @typedef {Child|Root} Node
 * @typedef {import('htmlparser2').Parser} Parser
 * @typedef {import('htmlparser2').ParserOptions} ParserOptions
 * // FIXME dont prefix types ...
 * @typedef {import('domhandler').Document} ParserDocument
 * @typedef {import('domhandler').Element} ParserElement
 * @typedef {import('domhandler').ChildNode} ParserNode
 * @typedef {import('domhandler').Text} ParserText
 * @typedef {import('domhandler').Comment} ParserComment
 * @typedef {import('domhandler').CDATA} ParserCDATA
 * @typedef {import('domhandler').NodeWithChildren} ParserNodeWithChildren
 * @typedef {import('domhandler').ProcessingInstruction} ParserProcessingInstruction
 * @typedef {import('domhandler').DataNode} ParserDataNode
 * @typedef {import('domhandler').AnyNode} ParserAnyNode
 * @typedef {import('domhandler').ParentNode} ParserParentNode
 *
 * @typedef {'html'|'svg'} Space
 *
 * @callback Handler
 * @param {Context} ctx
 * @param {ParserNode} node
 * @param {Array<Child>} [children]
 * @returns {Node}
 *
 * @typedef Options
 * @property {Space} [space='html'] Whether the root of the tree is in the `'html'` or `'svg'` space. If an element in with the SVG namespace is found in `ast`, `fromParse5` automatically switches to the SVG space when entering the element, and switches back when leaving
 * @property {VFile} [file] `VFile`, used to add positional information to nodes. If given, the file should have the original HTML source as its contents
 * @property {boolean} [verbose=false] Whether to add extra positional information about starting tags, closing tags, and attributes to elements. Note: not used without `file`
 *
 * @typedef Context
 * @property {Schema} schema
 * @property {VFile|undefined} file
 * @property {boolean|undefined} verbose
 * @property {boolean} location
 */

import {h, s} from 'hastscript'
import {html, svg, find} from 'property-information'
import {location} from 'vfile-location'
import {webNamespaces} from 'web-namespaces'

const own = {}.hasOwnProperty

// Handlers.
const map = {
  '#document': root,
  '#document-fragment': root,
  '#text': text,
  '#comment': comment,
  '#documentType': doctype
}

/**
 * Transform Parse5’s AST to a hast tree.
 *
 * @param {ParserNode} ast
 * @param {Options|VFile} [options]
 */
export function fromHtmlparser2(ast, options = {}) {
  /** @type {Options} */
  let settings
  /** @type {VFile|undefined} */
  let file

  if (isFile(options)) {
    file = options
    settings = {}
  } else {
    file = options.file
    settings = options
  }

  return transform(
    {
      schema: settings.space === 'svg' ? svg : html,
      file,
      verbose: settings.verbose,
      location: false
    },
    ast
  )
}

/**
 * Transform children.
 *
 * @param {Context} ctx
 * @param {ParserNode} ast
 * @returns {Node}
 */
function transform(ctx, ast) {
  const schema = ctx.schema
  /** @type {Handler} */
  if (!['text', 'tag', 'comment', 'root'].includes(ast.type)) {
    console.dir({ ast })
    throw new Error(`unexpected ast.type ${ast.type}`)
  }
  const fn = (
    ast.type == 'text' ? text :
    // @ts-ignore
    ast.type == 'tag' ? element : // { name: 'section', attribs: {}, children: [] }
    ast.type == 'comment' ? comment : // { data: 'hello' }
    ast.type == 'root' ? root : // { children: [] }
    // TODO remove?
    own.call(map, ast.nodeName) ? map[ast.nodeName] :
    element
  )
  /** @type {Array<Child>|undefined} */
  let children

  // Element.
  if ('tagName' in ast) {
    ctx.schema = ast.namespace === webNamespaces.svg ? svg : html
  }

  if ('childNodes' in ast) {
    children = nodes(ctx, ast.childNodes)
  }

  const result = fn(ctx, ast, children)

  if ('sourceCodeLocation' in ast && ast.sourceCodeLocation && ctx.file) {
    const position = createLocation(ctx, result, ast.sourceCodeLocation)

    if (position) {
      ctx.location = true
      result.position = position
    }
  }

  ctx.schema = schema

  return result
}

/**
 * Transform children.
 *
 * @param {Context} ctx
 * @param {Array<ParserNode>} children
 * @returns {Array<Child>}
 */
function nodes(ctx, children) {
  let index = -1
  /** @type {Array<Child>} */
  const result = []

  while (++index < children.length) {
    // @ts-expect-error Assume no roots in children.
    result[index] = transform(ctx, children[index])
  }

  return result
}

/**
 * Transform a document.
 * Stores `ast.quirksMode` in `node.data.quirksMode`.
 *
 * @type {Handler}
 * @param {ParserDocument} ast
 * @param {Array<Child>} children
 * @returns {Root}
 */
function root(ctx, ast, children) {
  /** @type {Root} */
  const result = {
    type: 'root',
    children,
    data: {quirksMode: ast['x-mode'] === 'quirks' || ast['x-mode'] === 'limited-quirks'}
  }

  if (ctx.file && ctx.location) {
    const doc = String(ctx.file)
    const loc = location(doc)
    result.position = {
      start: loc.toPoint(0),
      end: loc.toPoint(doc.length)
    }
  }

  return result
}

/**
 * Transform a doctype.
 *
 * @type {Handler}
 * @returns {Doctype}
 */
function doctype() {
  // @ts-expect-error Types are out of date.
  return {type: 'doctype'}
}

/**
 * Transform a text.
 *
 * @type {Handler}
 * @param {ParserText} ast
 * @returns {Text}
 */
function text(_, ast) {
  return {type: 'text', value: ast.data}
}

/**
 * Transform a comment.
 *
 * // TODO move typedef
 * @typedef {{type: 'cdata', value: string}} CDATA
 *
 * @type {Handler}
 * @param {ParserComment} ast
 * @returns {Comment|CDATA}
 */
function comment(_, ast) {
  if (ast.data.startsWith('[CDATA[') && ast.data.endsWith(']]')) {
    return {
      type: 'cdata',
      value: ast.data.slice(7, -2) // unwrap the cdata string
    }
  }
  return {type: 'comment', value: ast.data}
}

/**
 * Transform an element.
 *
 * @type {Handler}
 * @param {ParserElement} ast
 * @param {Array<ElementChild>} children
 * @returns {Element}
 */
function element(ctx, ast, children) {
  // FIXME this is just a workaround.
  // type text shuold call handler text()
  // @ts-ignore
  if (ast.type == 'text') {
    // @ts-ignore
    return {type: 'text', value: ast.data}
  }
  const fn = ctx.schema.space === 'svg' ? s : h
  let index = -1
  /** @type {Record<string, string>} */
  const props = {}
  //console.log('hast-util-from-htmlparser2/lib/index.js')
  //console.dir({ast, children})
  // FIXME TypeError: Cannot read properties of undefined (reading 'length')
  while (++index < (ast.attributes || []).length) {
    const attribute = ast.attributes[index]
    props[(attribute.prefix ? attribute.prefix + ':' : '') + attribute.name] =
      attribute.value
  }

  // FIXME Error: Expected node, nodes, or string, got `[object Object]`
  //const result = fn(ast.tagName, props, children)
  const result = fn(ast.tagName, props, (children || []))

  if (result.tagName === 'template' && 'content' in ast) {
    const pos = ast.sourceCodeLocation
    const startTag = pos && pos.startTag && position(pos.startTag)
    const endTag = pos && pos.endTag && position(pos.endTag)

    /** @type {Root} */
    // @ts-expect-error Types are wrong.
    const content = transform(ctx, ast.content)

    if (startTag && endTag && ctx.file) {
      content.position = {start: startTag.end, end: endTag.start}
    }

    result.content = content
  }

  return result
}

/**
 * Create clean positional information.
 *
 * // FIXME
 * @typedef {any} ParserElementLocation
 *
 * @param {Context} ctx
 * @param {Node} node
 * @param {ParserElementLocation} location
 * @returns {Position|null}
 */
function createLocation(ctx, node, location) {
  console.log('createLocation: location:')
  console.dir(location)
  const result = position(location)

  if (node.type === 'element') {
    const tail = node.children[node.children.length - 1]

    // Bug for unclosed with children.
    // See: <https://github.com/inikulin/parse5/issues/109>.
    if (
      result &&
      !location.endTag &&
      tail &&
      tail.position &&
      tail.position.end
    ) {
      result.end = Object.assign({}, tail.position.end)
    }

    if (ctx.verbose) {
      /** @type {Record<string, Position|null>} */
      const props = {}
      /** @type {string} */
      let key

      if (location.attrs) {
        for (key in location.attrs) {
          if (own.call(location.attrs, key)) {
            props[find(ctx.schema, key).property] = position(
              location.attrs[key]
            )
          }
        }
      }

      node.data = {
        position: {
          // @ts-expect-error: assume not `undefined`.
          opening: position(location.startTag),
          closing: location.endTag ? position(location.endTag) : null,
          properties: props
        }
      }
    }
  }

  return result
}

/**
 * // FIXME
 * @typedef {any} P5Location
 *
 * @param {P5Location} loc
 * @returns {Position|null}
 */
function position(loc) {
  const start = point({
    line: loc.startLine,
    column: loc.startCol,
    offset: loc.startOffset
  })
  const end = point({
    line: loc.endLine,
    column: loc.endCol,
    offset: loc.endOffset
  })
  // @ts-expect-error `null` is fine.
  return start || end ? {start, end} : null
}

/**
 * @param {Point} point
 * @returns {Point|null}
 */
function point(point) {
  return point.line && point.column ? point : null
}

/**
 * @param {VFile|Options} value
 * @returns {value is VFile}
 */
function isFile(value) {
  return 'messages' in value
}
