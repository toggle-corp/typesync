import { python } from '../../platforms/python/index.js';
import { schema } from '../../schema/index.js';
import { assertNever } from '../../util/assert.js';
import { adjustSchemaForPython } from './_adjust-schema.js';
import { flatTypeToPython } from './_converters.js';
import type {
  PythonAliasDeclaration,
  PythonDeclaration,
  PythonEnumClassDeclaration,
  PythonGeneration,
  PythonGenerator,
  PythonGeneratorConfig,
  PythonPydanticClassDeclaration,
} from './_types.js';

interface Node<T> {
  key: string;
  item: T;
  incomingNodesKey: Set<string>;
  index: number;
  outgoingNodesKey: Set<string>;
}

function createGraph<T>(items: T[], getKey: (item: T) => string, getIncomingNodesKey: (item: T) => Set<string>) {
  const graph: Record<string, Node<T>> = {};
  const outgoingNodesMap: Record<string, Set<string>> = {};

  // Populate graph with incoming nodes
  for (const [index, item] of items.entries()) {
    const nodeKey = getKey(item);
    const incomingNodesKey = getIncomingNodesKey(item);

    graph[nodeKey] = {
      key: nodeKey,
      item,
      incomingNodesKey,
      index,
      outgoingNodesKey: new Set<string>(),
    };

    // Create a outgoing nodes mapping
    for (const incomingNodeKey of incomingNodesKey) {
      if (!outgoingNodesMap[incomingNodeKey]) {
        outgoingNodesMap[incomingNodeKey] = new Set();
      }
      outgoingNodesMap[incomingNodeKey].add(nodeKey);
    }
  }

  // Set outgoing nodes on graph
  for (const nodeKey of Object.keys(graph)) {
    const value = graph[nodeKey];
    if (value) {
      graph[nodeKey] = {
        ...value,
        outgoingNodesKey: outgoingNodesMap[nodeKey] ?? new Set<string>(),
      };
    }
  }

  return graph;
}

function removeFromGraph<T>(graph: Record<string, Node<T>>, removeKey: string) {
  const nodeToRemove = graph[removeKey];
  if (!nodeToRemove) {
    throw Error(`Error while removing node with key ${removeKey}`);
  }

  // Remove from graph
  delete graph[removeKey];

  // Update incomingNodesKey from outgoingNodes
  const affectedOutgoingNodes = [];
  for (const outgoingNodeKey of nodeToRemove.outgoingNodesKey) {
    const outgoingNode = graph[outgoingNodeKey];
    if (outgoingNode) {
      outgoingNode.incomingNodesKey.delete(removeKey);
      affectedOutgoingNodes.push(outgoingNode);
    }
  }

  return affectedOutgoingNodes;
}

function topoSortGraph<T>(graph: Record<string, Node<T>>) {
  const orderedNodeList = [];

  const removableNodesQueue = Object.values(graph).filter(item => item.incomingNodesKey.size === 0);
  removableNodesQueue.sort((foo, bar) => foo.index - bar.index);

  if (removableNodesQueue.length <= 0) {
    throw Error(`Expected removableNodes to greater than zero while sorting.`);
  }

  while (removableNodesQueue.length > 0) {
    const removedNode = removableNodesQueue.shift();
    if (!removedNode) {
      break;
    }
    orderedNodeList.push(removedNode);

    const affectedOutgoingNodes = removeFromGraph(graph, removedNode.key);

    const removableNodes = affectedOutgoingNodes.filter(node => node.incomingNodesKey.size === 0);
    if (removableNodes.length > 0) {
      removableNodesQueue.push(...removableNodes);
      removableNodesQueue.sort((foo, bar) => foo.index - bar.index);
    }
  }

  const graphNodesCount = Object.keys(graph).length;
  if (graphNodesCount != 0) {
    throw Error(`Expected graph to have no nodes left while sorting. But got ${graphNodesCount} nodes`);
  }

  return orderedNodeList;
}

class PythonGeneratorImpl implements PythonGenerator {
  public constructor(private readonly config: PythonGeneratorConfig) {}

  public generate(s: schema.Schema): PythonGeneration {
    const adjustedSchema = adjustSchemaForPython(s);
    const { aliasModels, documentModels } = adjustedSchema;
    const declarations: PythonDeclaration[] = [];
    aliasModels.forEach(model => {
      const d = this.createDeclarationForAliasModel(model);
      declarations.push(d);
    });
    documentModels.forEach(model => {
      const d = this.createDeclarationForDocumentModel(model);
      declarations.push(d);
    });

    // NOTE: Create a graph so that we can sort topologically
    const graph = createGraph(
      declarations,
      item => item.modelName,
      item => {
        if (item.modelType.type !== 'object-class') {
          // NOTE: we can skip enum-class
          console.warn(`Skipping declaration "${item.modelName}" as modelType is ${item.modelType.type}`);
          return new Set<string>();
        }
        const deps = new Set<string>();
        for (const attribute of item.modelType.attributes) {
          if (attribute.type.type === 'alias') {
            deps.add(attribute.type.name);
          } else if (attribute.type.type === 'dict') {
            if (attribute.type.valueType.type === 'alias') {
              deps.add(attribute.type.valueType.name);
            }
          } else if (attribute.type.type === 'list') {
            if (attribute.type.elementType.type === 'alias') {
              deps.add(attribute.type.elementType.name);
            }
          }
          // TODO(tnagorra): Handle union, tuple
        }
        return deps;
      }
    );

    const sortedDeclarations = topoSortGraph(graph);
    return {
      type: 'python',
      declarations: sortedDeclarations.map(node => node.item),
    };
  }

  private createDeclarationForAliasModel(model: schema.python.AliasModel): PythonDeclaration {
    switch (model.type.type) {
      case 'any':
      case 'unknown':
      case 'nil':
      case 'string':
      case 'boolean':
      case 'int':
      case 'double':
      case 'timestamp':
      case 'string-literal':
      case 'int-literal':
      case 'boolean-literal':
      case 'tuple':
      case 'list':
      case 'map':
      case 'discriminated-union':
      case 'simple-union':
      case 'alias':
        return this.createDeclarationForFlatType(model.type, model.name, model.docs);
      case 'string-enum':
      case 'int-enum':
        return this.createDeclarationForEnumType(model.type, model.name, model.docs);
      case 'object':
        return this.createDeclarationForFlatObjectType(model.type, model.name, model.docs);
      default:
        assertNever(model.type);
    }
  }

  private createDeclarationForDocumentModel(model: schema.python.DocumentModel): PythonDeclaration {
    // A Firestore document can be considered an 'object' type
    return this.createDeclarationForFlatObjectType(model.type, model.name, model.docs);
  }

  private createDeclarationForEnumType(
    type: schema.python.types.Enum,
    modelName: string,
    modelDocs: string | null
  ): PythonEnumClassDeclaration {
    const pythonType: python.EnumClass = {
      type: 'enum-class',
      attributes: type.members.map(item => ({
        key: item.label,
        value: item.value,
      })),
    };
    return {
      type: 'enum-class',
      modelName,
      modelType: pythonType,
      modelDocs,
    };
  }

  private createDeclarationForFlatObjectType(
    type: schema.python.types.Object,
    modelName: string,
    modelDocs: string | null
  ): PythonPydanticClassDeclaration {
    const pythonType: python.ObjectClass = {
      type: 'object-class',
      attributes: type.fields.map(f => ({
        name: f.name,
        type: flatTypeToPython(f.type),
        docs: f.docs,
        optional: f.optional,
        deprecated: f.deprecated,
      })),
      additionalAttributes: type.additionalFields,
    };
    return {
      type: 'pydantic-class',
      modelName,
      modelType: pythonType,
      modelDocs,
    };
  }

  private createDeclarationForFlatType(
    type: schema.python.types.Type,
    modelName: string,
    modelDocs: string | null
  ): PythonAliasDeclaration {
    const pythonType = flatTypeToPython(type);
    return {
      type: 'alias',
      modelName,
      modelType: pythonType,
      modelDocs,
    };
  }
}

export function createPythonGenerator(config: PythonGeneratorConfig): PythonGenerator {
  return new PythonGeneratorImpl(config);
}
