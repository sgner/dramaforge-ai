import { toast } from '../utils/toast';

interface StorageData {
  tasks: any[];
  timestamp: number;
  version: string;
}

class StorageService {
  private readonly STORAGE_KEY_TASKS = 'dramaforge_tasks';
  private readonly STORAGE_KEY_BACKUP = 'dramaforge_tasks_backup';
  private readonly STORAGE_KEY_AUTO_BACKUP = 'dramaforge_tasks_autobackup';
  private readonly MAX_RETRIES = 3;
  private readonly STORAGE_QUOTA_WARNING = 0.8;

  private checkStorageQuota(): boolean {
    try {
      const testKey = '__storage_test__';
      const testValue = 'x'.repeat(1024 * 1024);
      localStorage.setItem(testKey, testValue);
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      console.error('Storage quota exceeded:', e);
      return false;
    }
  }

  private getStorageSize(): number {
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return total;
  }

  private saveBackup(data: StorageData): void {
    try {
      const backupKey = `${this.STORAGE_KEY_BACKUP}_${Date.now()}`;
      localStorage.setItem(backupKey, JSON.stringify(data));
      
      const backups = this.listBackups();
      if (backups.length > 5) {
        const oldestBackup = backups[backups.length - 1];
        localStorage.removeItem(oldestBackup.key);
      }
    } catch (e) {
      console.error('Failed to save backup:', e);
    }
  }

  private listBackups(): Array<{ key: string; timestamp: number }> {
    const backups: Array<{ key: string; timestamp: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.STORAGE_KEY_BACKUP)) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          backups.push({ key, timestamp: data.timestamp || 0 });
        } catch (e) {
          console.error('Failed to parse backup:', key);
        }
      }
    }
    return backups.sort((a, b) => b.timestamp - a.timestamp);
  }

  saveTasks(tasks: any[]): boolean {
    let retries = 0;
    const data: StorageData = {
      tasks,
      timestamp: Date.now(),
      version: '1.0'
    };

    while (retries < this.MAX_RETRIES) {
      try {
        const json = JSON.stringify(data);
        const size = json.length;
        
        localStorage.setItem(this.STORAGE_KEY_TASKS, json);
        
        this.saveBackup(data);
        
        return true;
      } catch (e: any) {
        retries++;
        console.error(`[StorageService] Save attempt ${retries} failed:`, e);
        
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          console.warn('[StorageService] Storage quota exceeded, trying to clear old backups...');
          this.clearOldBackups();
          
          if (retries >= this.MAX_RETRIES) {
            toast.error('存储空间不足，请清理浏览器缓存或导出项目备份');
            return false;
          }
        }
      }
    }
    
    return false;
  }

  loadTasks(): any[] | null {
    try {
      const savedTasks = localStorage.getItem(this.STORAGE_KEY_TASKS);
      if (savedTasks) {
        const data: StorageData = JSON.parse(savedTasks);
        console.log(`[StorageService] Loaded ${data.tasks.length} tasks from ${new Date(data.timestamp).toLocaleString()}`);
        return data.tasks;
      }
    } catch (e) {
      console.error('[StorageService] Failed to load tasks:', e);
    }
    
    return null;
  }

  loadFromBackup(): any[] | null {
    const backups = this.listBackups();
    if (backups.length === 0) {
      console.log('[StorageService] No backups found');
      return null;
    }
    
    try {
      const latestBackup = backups[0];
      const backupData = localStorage.getItem(latestBackup.key);
      if (backupData) {
        const data: StorageData = JSON.parse(backupData);
        console.log(`[StorageService] Loaded ${data.tasks.length} tasks from backup (${new Date(data.timestamp).toLocaleString()})`);
        return data.tasks;
      }
    } catch (e) {
      console.error('[StorageService] Failed to load backup:', e);
    }
    
    return null;
  }

  clearOldBackups(): void {
    const backups = this.listBackups();
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    
    backups.forEach(backup => {
      if (now - backup.timestamp > sevenDays) {
        localStorage.removeItem(backup.key);
        console.log(`[StorageService] Removed old backup: ${backup.key}`);
      }
    });
  }

  exportToFile(tasks: any[], filename: string): void {
    const data: StorageData = {
      tasks,
      timestamp: Date.now(),
      version: '1.0'
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log(`[StorageService] Exported ${tasks.length} tasks to ${filename}`);
  }

  importFromFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data: StorageData = JSON.parse(content);
          
          if (data.tasks && Array.isArray(data.tasks)) {
            console.log(`[StorageService] Imported ${data.tasks.length} tasks from file`);
            resolve(data.tasks);
          } else {
            reject(new Error('Invalid file format'));
          }
        } catch (error) {
          console.error('[StorageService] Import failed:', error);
          reject(error);
        }
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY_TASKS);
    this.clearOldBackups();
  }

  getStorageInfo(): { used: number; total: number; tasksCount: number } {
    const used = this.getStorageSize();
    const tasksData = localStorage.getItem(this.STORAGE_KEY_TASKS);
    const tasksCount = tasksData ? JSON.parse(tasksData).tasks?.length || 0 : 0;

    return {
      used,
      total: 5 * 1024 * 1024,
      tasksCount
    };
  }
}

export const storageService = new StorageService();
