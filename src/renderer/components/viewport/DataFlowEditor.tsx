/**
 * DataFlowEditor — Data pipeline configuration
 *
 * Three-layer structure:
 * Left: DataSource (input source)
 * Middle: Transform (data processing)
 * Right: DataStore (output variables)
 *
 * Compliant with EditorUI.txt:
 * - DataSource retrieves data → Store in DataStore
 * - TransformがDataStore値を読込 → 計算結果を別の変数に格納
 * - UIがDataStoreをbindで参照（読取専用）
 */
import React, { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type {
  DataSourceDefinition,
  DataSourceType,
  TransformDefinition,
  TransformType,
} from '../../../shared/types';
import {
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  Smartphone,
  Wifi,
  Clock,
  Radio,
  MessageSquare,
} from 'lucide-react';

export function DataFlowEditor() {
  const { project, addDataSource, updateDataSource, removeDataSource, addTransform, updateTransform, removeTransform } = useProjectStore();

  const dataFlow = project?.dataFlow || { dataSources: [], transforms: [] };
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingTransformId, setEditingTransformId] = useState<string | null>(null);

  if (!project?.dataFlow) {
    return (
      <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm bg-[#121212]">
        プロジェクトが読み込まれていません
      </div>
    );
  }

  return (
    <div className="w-full h-full flex overflow-hidden bg-[#0a0a0a]">
      {/* 左: DataSource */}
      <div className="flex-1 flex flex-col border-r border-[#2d2d2d] overflow-hidden bg-[#121212]">
        <div className="h-12 bg-[#1e1e1e] border-b border-[#2d2d2d] px-4 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm text-[#e0e0e0]">データ入力元</h3>
          <button
            onClick={() => setEditingSourceId('new')}
            className="px-2 h-7 rounded-lg bg-[#2196F3] hover:bg-[#1976D2] text-xs text-white flex items-center gap-1 transition-colors"
          >
            <Plus size={14} />
            追加
          </button>
        </div>

        {/* DataSource一覧 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {dataFlow.dataSources.length === 0 ? (
            <div className="text-xs text-arsist-muted text-center py-8">
              データソースなし
            </div>
          ) : (
            dataFlow.dataSources.map((source) => (
              <DataSourceCard
                key={source.id}
                source={source}
                isEditing={editingSourceId === source.id}
                onEdit={() => setEditingSourceId(source.id)}
                onDelete={() => removeDataSource(source.id)}
                onUpdate={(updates) => updateDataSource(source.id, updates)}
                onEditClose={() => setEditingSourceId(null)}
              />
            ))
          )}
        </div>
      </div>

      {/* 中央: Transform */}
      <div className="flex-1 flex flex-col border-r border-[#2d2d2d] overflow-hidden bg-[#121212]">
        <div className="h-12 bg-[#1e1e1e] border-b border-[#2d2d2d] px-4 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm text-[#e0e0e0]">データ加工</h3>
          <button
            onClick={() => setEditingTransformId('new')}
            className="px-2 h-7 rounded-lg bg-[#4CAF50] hover:bg-[#388E3C] text-xs text-white flex items-center gap-1 transition-colors"
          >
            <Plus size={14} />
            追加
          </button>
        </div>

        {/* Transform一覧 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {dataFlow.transforms.length === 0 ? (
            <div className="text-xs text-arsist-muted text-center py-8">
              トランスフォームなし
            </div>
          ) : (
            dataFlow.transforms.map((transform) => (
              <TransformCard
                key={transform.id}
                transform={transform}
                isEditing={editingTransformId === transform.id}
                onEdit={() => setEditingTransformId(transform.id)}
                onDelete={() => removeTransform(transform.id)}
                onUpdate={(updates) => updateTransform(transform.id, updates)}
                onEditClose={() => setEditingTransformId(null)}
              />
            ))
          )}
        </div>
      </div>

      {/* 右: DataStore（変数一覧） */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#121212]">
        <div className="h-12 bg-[#1e1e1e] border-b border-[#2d2d2d] px-4 flex items-center shrink-0">
          <h3 className="font-semibold text-sm text-[#e0e0e0]">DataStore（変数）</h3>
        </div>

        {/* 変数一覧 */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {/* DataSourceからの変数 */}
            {dataFlow.dataSources.length > 0 && (
              <>
                <div className="text-xs font-semibold text-[#64B5F6] mb-2">入力元からの変数</div>
                {dataFlow.dataSources.map((source) => (
                  <div key={source.id} className="text-xs bg-[#1e1e1e] px-2 py-1.5 rounded border border-[#2d2d2d]">
                    <div className="text-[#90CAF9] font-mono">{source.storeAs}</div>
                    <div className="text-[#9e9e9e] text-[10px]">{source.type}</div>
                  </div>
                ))}
              </>
            )}

            {/* Transformからの変数 */}
            {dataFlow.transforms.length > 0 && (
              <>
                <div className="text-xs font-semibold text-[#81C784] mb-2 mt-3">加工後の変数</div>
                {dataFlow.transforms.map((transform) => (
                  <div key={transform.id} className="text-xs bg-[#1e1e1e] px-2 py-1.5 rounded border border-[#2d2d2d]">
                    <div className="text-[#A5D6A7] font-mono">{transform.storeAs}</div>
                    <div className="text-[#9e9e9e] text-[10px]">{transform.type}</div>
                  </div>
                ))}
              </>
            )}

            {dataFlow.dataSources.length === 0 && dataFlow.transforms.length === 0 && (
              <div className="text-xs text-arsist-muted text-center py-8">
                DataSourceとTransformを追加してください
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ──編集モーダル ── */}
      {editingSourceId && (
        <SourceEditModal
          sourceId={editingSourceId === 'new' ? null : editingSourceId}
          onClose={() => setEditingSourceId(null)}
          onSave={(source) => {
            if (editingSourceId === 'new') {
              addDataSource(source);
            }
            setEditingSourceId(null);
          }}
          dataSources={dataFlow.dataSources}
        />
      )}

      {editingTransformId && (
        <TransformEditModal
          transformId={editingTransformId === 'new' ? null : editingTransformId}
          onClose={() => setEditingTransformId(null)}
          onSave={(transform) => {
            if (editingTransformId === 'new') {
              addTransform(transform);
            }
            setEditingTransformId(null);
          }}
          dataStoreKeys={[
            ...dataFlow.dataSources.map((s) => s.storeAs),
            ...dataFlow.transforms.map((t) => t.storeAs),
          ]}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   DataSourceカード
   ════════════════════════════════════════ */
interface DataSourceCardProps {
  source: DataSourceDefinition;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<DataSourceDefinition>) => void;
  onEditClose: () => void;
}

function DataSourceCard({ source, isEditing, onEdit, onDelete }: DataSourceCardProps) {
  const iconMap: Record<DataSourceType, React.ReactNode> = {
    XR_Tracker: <Smartphone size={14} />,
    XR_HandPose: <Smartphone size={14} />,
    Device_Status: <Smartphone size={14} />,
    Location_Provider: <Smartphone size={14} />,
    REST_Client: <Radio size={14} />,
    WebSocket_Stream: <Wifi size={14} />,
    MQTT_Subscriber: <MessageSquare size={14} />,
    System_Clock: <Clock size={14} />,
    Voice_Recognition: <Smartphone size={14} />,
    Microphone_Level: <Smartphone size={14} />,
  };

  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-lg p-3 hover:border-[#3d3d3d] transition-colors">
      <div className="flex items-start gap-2">
        <div className="text-[#64B5F6] mt-0.5">{iconMap[source.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#e0e0e0] truncate">{source.type}</div>
          <div className="text-xs text-[#9e9e9e] mt-1">
            store: <span className="font-mono text-[#90CAF9]">{source.storeAs}</span>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-[#2d2d2d] text-[#9e9e9e] hover:text-[#e0e0e0] transition-colors"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-[#2d2d2d] text-[#9e9e9e] hover:text-[#f44336] transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Transformカード
   ════════════════════════════════════════ */
interface TransformCardProps {
  transform: TransformDefinition;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<TransformDefinition>) => void;
  onEditClose: () => void;
}

function TransformCard({ transform, isEditing, onEdit, onDelete }: TransformCardProps) {
  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-lg p-3 hover:border-[#3d3d3d] transition-colors">
      <div className="flex items-start gap-2">
        <div className="text-[#81C784] mt-0.5">
          <ChevronRight size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#e0e0e0] truncate">{transform.type}</div>
          <div className="text-xs text-[#9e9e9e] mt-1 space-y-0.5">
            <div>
              input: <span className="font-mono text-[#64B5F6]">{transform.inputs?.join(', ')}</span>
            </div>
            <div>
              store: <span className="font-mono text-[#A5D6A7]">{transform.storeAs}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-[#2d2d2d] text-[#9e9e9e] hover:text-[#e0e0e0] transition-colors"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-[#2d2d2d] text-[#9e9e9e] hover:text-[#f44336] transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DataSource編集モーダル
   ════════════════════════════════════════ */
interface SourceEditModalProps {
  sourceId: string | null;
  onClose: () => void;
  onSave: (source: Partial<DataSourceDefinition>) => void;
  dataSources: DataSourceDefinition[];
}

function SourceEditModal({ sourceId, onClose, onSave, dataSources }: SourceEditModalProps) {
  const [type, setType] = useState<DataSourceType>('REST_Client');
  const [storeAs, setStoreAs] = useState('');

  const sourceTypes: DataSourceType[] = [
    'XR_Tracker',
    'XR_HandPose',
    'Device_Status',
    'Location_Provider',
    'REST_Client',
    'WebSocket_Stream',
    'MQTT_Subscriber',
    'System_Clock',
    'Voice_Recognition',
    'Microphone_Level',
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-lg p-6 w-96">
        <h2 className="text-lg font-semibold text-[#e0e0e0] mb-4">DataSetupの追加</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#9e9e9e] mb-1">タイプ</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as DataSourceType)}
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0]"
            >
              {sourceTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#9e9e9e] mb-1">変数名 (store_as)</label>
            <input
              type="text"
              value={storeAs}
              onChange={(e) => setStoreAs(e.target.value)}
              placeholder="例: gps_latitude"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0]"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] text-[#e0e0e0] text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              if (storeAs) {
                onSave({ type, storeAs });
              }
            }}
            className="flex-1 px-4 py-2 rounded-lg bg-[#2196F3] hover:bg-[#1976D2] text-white text-sm transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Transform編集モーダル
   ════════════════════════════════════════ */
interface TransformEditModalProps {
  transformId: string | null;
  onClose: () => void;
  onSave: (transform: Partial<TransformDefinition>) => void;
  dataStoreKeys: string[];
}

function TransformEditModal({ transformId, onClose, onSave, dataStoreKeys }: TransformEditModalProps) {
  const [type, setType] = useState<TransformType>('Formula');
  const [storeAs, setStoreAs] = useState('');
  const [inputs, setInputs] = useState<string[]>([]);
  const [formula, setFormula] = useState('');

  const transformTypes: TransformType[] = [
    'Formula',
    'Clamper',
    'Remap',
    'Smoother',
    'Comparator',
    'Threshold',
    'State_Mapper',
    'String_Template',
    'Time_Formatter',
    'History_Buffer',
    'Accumulator',
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-lg p-6 w-96">
        <h2 className="text-lg font-semibold text-[#e0e0e0] mb-4">トランスフォームの追加</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#9e9e9e] mb-1">タイプ</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TransformType)}
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0]"
            >
              {transformTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#9e9e9e] mb-1">入力元 (複数選択可、カンマ区切り)</label>
            <input
              type="text"
              value={inputs.join(', ')}
              onChange={(e) => setInputs(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder="例: speed, temperature"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0]"
            />
          </div>

          {type === 'Formula' && (
            <div>
              <label className="block text-xs font-medium text-[#9e9e9e] mb-1">式（例：val * 1.8 + 32）</label>
              <input
                type="text"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0] font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#9e9e9e] mb-1">結果の変数名 (store_as)</label>
            <input
              type="text"
              value={storeAs}
              onChange={(e) => setStoreAs(e.target.value)}
              placeholder="例: speed_kmh"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#2d2d2d] text-sm text-[#e0e0e0]"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] text-[#e0e0e0] text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              if (storeAs && inputs.length > 0) {
                onSave({ type, storeAs, inputs, parameters: type === 'Formula' ? { formula } : {} });
              }
            }}
            className="flex-1 px-4 py-2 rounded-lg bg-[#4CAF50] hover:bg-[#388E3C] text-white text-sm transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
