import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Glasses, Layout, Monitor, MapPin } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { ProjectTemplate } from '../../../shared/types';

interface NewProjectDialogProps {
  onClose: () => void;
}

interface TemplateOption {
  id: ProjectTemplate;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const templates: TemplateOption[] = [
  {
    id: '3d_ar_scene',
    name: '3D AR Scene',
    description: '6DoF tracking. Standard AR with 3D objects in space',
    icon: <Glasses size={32} />,
  },
  {
    id: '2d_floating_screen',
    name: '2D Floating Screen',
    description: '3DoF tracking. Fixed 2D display in front of view',
    icon: <Monitor size={32} />,
  },
  {
    id: 'head_locked_hud',
    name: 'Head-Locked HUD',
    description: 'Head-locked. Ideal for fixed HUD overlay',
    icon: <Layout size={32} />,
  },
];

const devices = [
  { id: 'XREAL_One', name: 'XREAL One', available: true },
  { id: 'Meta_Quest', name: 'Meta Quest', available: true },
  { id: 'XREAL_Air2', name: 'XREAL Air 2', available: false },
  { id: 'Rokid_Max', name: 'Rokid Max', available: false },
  { id: 'VITURE_One', name: 'VITURE One', available: false },
];

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const { createProject } = useProjectStore();
  const { addNotification } = useUIStore();
  
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState('MyARApp');
  const [projectPath, setProjectPath] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate>('3d_ar_scene');
  const [selectedDevice, setSelectedDevice] = useState('XREAL_One');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    // Get default path
    const loadDefaultPath = async () => {
      if (window.electronAPI) {
        const storedPath = await window.electronAPI.store.get('defaultProjectPath');
        if (storedPath) {
          setProjectPath(storedPath);
        }
      }
    };
    loadDefaultPath();
  }, []);

  const handleSelectPath = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectDirectory();
    if (path) {
      setProjectPath(path);
      await window.electronAPI.store.set('defaultProjectPath', path);
    }
  };

  const handleCreate = async () => {
    if (!projectName || !projectPath) {
      addNotification({ type: 'error', message: 'Please enter project name and path' });
      return;
    }

    setIsCreating(true);
    
    try {
      await createProject({
        name: projectName,
        path: projectPath,
        template: selectedTemplate,
        targetDevice: selectedDevice,
      });
      
      addNotification({ type: 'success', message: 'Project created successfully' });
      onClose();
    } catch (error) {
      addNotification({ type: 'error', message: `Failed to create project: ${error}` });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal max-w-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header flex items-center justify-between">
          <span>New Project</span>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        {/* Steps Indicator */}
        <div className="px-6 py-3 border-b border-arsist-primary/30 flex items-center gap-4">
          <StepIndicator step={1} currentStep={step} label="Template" />
          <div className="flex-1 h-0.5 bg-arsist-primary/30" />
          <StepIndicator step={2} currentStep={step} label="Settings" />
          <div className="flex-1 h-0.5 bg-arsist-primary/30" />
          <StepIndicator step={3} currentStep={step} label="Device" />
        </div>

        {/* Content */}
        <div className="modal-body min-h-80">
          {/* Step 1: Template Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-arsist-muted text-sm mb-4">
                Select a project template
              </p>
              <div className="grid grid-cols-1 gap-3">
                {templates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template.id)}
                    className={`p-4 rounded-lg border text-left transition-all flex items-start gap-4 ${
                      selectedTemplate === template.id
                        ? 'border-arsist-accent bg-arsist-accent/10'
                        : 'border-arsist-primary/30 hover:border-arsist-primary'
                    }`}
                  >
                    <div className={`p-3 rounded-lg ${
                      selectedTemplate === template.id 
                        ? 'bg-arsist-accent/20 text-arsist-accent'
                        : 'bg-arsist-primary/30 text-arsist-muted'
                    }`}>
                      {template.icon}
                    </div>
                    <div>
                      <h3 className="font-medium mb-1">{template.name}</h3>
                      <p className="text-sm text-arsist-muted">{template.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Project Settings */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="input-label">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="input"
                  placeholder="MyARApp"
                />
              </div>

              <div>
                <label className="input-label">Save Location</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="input flex-1"
                    placeholder="/path/to/projects"
                  />
                  <button onClick={handleSelectPath} className="btn btn-secondary">
                    <FolderOpen size={18} />
                  </button>
                </div>
              </div>

              <div className="p-4 bg-arsist-bg rounded-lg">
                <h4 className="text-sm font-medium mb-2">Project Structure</h4>
                <pre className="text-xs text-arsist-muted font-mono">
{`${projectName}/
├── project.json
├── Assets/
│   ├── Textures/
│   ├── Models/
│   ├── Fonts/
│   └── Audio/
├── Scenes/
├── UI/
└── Build/`}
                </pre>
              </div>

              <div>
                <label className="input-label">UI Creation</label>
                <div className="p-3 rounded border border-arsist-accent bg-arsist-accent/10 text-xs">
                  <div className="font-medium">Integrated GUI Mode</div>
                  <div className="text-arsist-muted">Intuitive editing with Figma-like UI editor</div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Device Selection */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-arsist-muted text-sm mb-4">
                Select target device (can be changed later)
              </p>
              <div className="grid grid-cols-2 gap-3">
                {devices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => device.available && setSelectedDevice(device.id)}
                    disabled={!device.available}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      !device.available 
                        ? 'border-arsist-primary/20 opacity-50 cursor-not-allowed'
                        : selectedDevice === device.id
                          ? 'border-arsist-accent bg-arsist-accent/10'
                          : 'border-arsist-primary/30 hover:border-arsist-primary'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Glasses size={24} className={
                        selectedDevice === device.id ? 'text-arsist-accent' : 'text-arsist-muted'
                      } />
                      <div>
                        <h3 className="font-medium">{device.name}</h3>
                        {!device.available && (
                          <span className="text-xs text-arsist-muted">Coming Soon</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 p-4 bg-arsist-primary/20 rounded-lg">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-arsist-accent" />
                  Selected Device: {devices.find(d => d.id === selectedDevice)?.name}
                </h4>
                <p className="text-xs text-arsist-muted">
                  {selectedDevice === 'Meta_Quest'
                    ? 'Meta XR SDK (sdk/quest) • Unity 2022.3 LTS+ • OpenXR-compliant'
                    : 'XREAL One SDK 3.1.0 • Unity 2022.3.20f1 LTS • OpenXR-compliant'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="btn btn-ghost">
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button onClick={() => setStep(s => s + 1)} className="btn btn-primary">
              Next
            </button>
          ) : (
            <button 
              onClick={handleCreate} 
              className="btn btn-primary"
              disabled={isCreating || !projectName || !projectPath}
            >
              {isCreating ? (
                <>
                  <div className="spinner" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  label: string;
}

function StepIndicator({ step, currentStep, label }: StepIndicatorProps) {
  const isActive = currentStep >= step;
  const isCurrent = currentStep === step;
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
        isCurrent
          ? 'bg-arsist-accent text-white'
          : isActive
            ? 'bg-arsist-accent/50 text-white'
            : 'bg-arsist-primary/30 text-arsist-muted'
      }`}>
        {step}
      </div>
      <span className={`text-sm ${isCurrent ? 'text-arsist-text' : 'text-arsist-muted'}`}>
        {label}
      </span>
    </div>
  );
}
