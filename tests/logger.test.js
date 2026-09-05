import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../lib/utils/logger.js';

describe('Logger', () => {
    let originalConsole;

    beforeEach(() => {
        originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug
        };
        console.log = vi.fn();
        console.warn = vi.fn();
        console.error = vi.fn();
        console.debug = vi.fn();
    });

    afterEach(() => {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        console.debug = originalConsole.debug;
        Logger.DEBUG = false;
    });

    it('should default DEBUG to false', () => {
        expect(Logger.DEBUG).toBe(false);
    });

    it('should log info', () => {
        Logger.info('test info');
        expect(console.log).toHaveBeenCalledWith('WorkflowTiling: test info');
    });

    it('should log warn without error', () => {
        Logger.warn('test warn');
        expect(console.warn).toHaveBeenCalledWith('WorkflowTiling: [WARN] test warn');
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('should log warn with error', () => {
        const err = new Error('warn error');
        Logger.warn('test warn', err);
        expect(console.warn).toHaveBeenCalledWith('WorkflowTiling: [WARN] test warn');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WorkflowTiling: [WARN-TRACE]'));
        expect(console.warn).toHaveBeenCalledTimes(2);
    });

    it('should log error without error object', () => {
        Logger.error('test error');
        expect(console.error).toHaveBeenCalledWith('WorkflowTiling: [ERROR] test error');
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it('should log error with error object', () => {
        const err = new Error('fatal error');
        Logger.error('test error', err);
        expect(console.error).toHaveBeenCalledWith('WorkflowTiling: [ERROR] test error');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WorkflowTiling: [ERROR-TRACE]'));
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('should log debug when DEBUG is true', () => {
        Logger.DEBUG = true;
        Logger.debug('test debug');
        expect(console.log).toHaveBeenCalledWith('WorkflowTiling: [DEBUG] test debug');
    });

    it('should not log debug when DEBUG is false', () => {
        Logger.DEBUG = false;
        Logger.debug('test debug');
        expect(console.log).not.toHaveBeenCalledWith('WorkflowTiling: [DEBUG] test debug');
    });
});

describe('SettingsManager debug logging sync', () => {
    it('should update Logger.DEBUG based on settings', async () => {
        const { SettingsManager } = await import('../lib/settings.js');
        const listeners = {};
        const mockSettings = {
            'enable-gaps': false,
            'debug-logging': false,
            'custom-layouts': '',
            'monitor-transition-behavior': 'escalate'
        };

        const mockExtension = {
            getSettings: () => ({
                get_boolean: (key) => mockSettings[key] ?? false,
                get_int: () => 0,
                get_string: (key) => mockSettings[key] ?? '',
                connect: (signal, cb) => {
                    listeners[signal] = cb;
                    return signal;
                },
                disconnect: vi.fn()
            })
        };

        const sm = new SettingsManager(mockExtension);
        expect(Logger.DEBUG).toBe(false);

        mockSettings['debug-logging'] = true;
        listeners['changed::debug-logging']();
        expect(Logger.DEBUG).toBe(true);

        mockSettings['debug-logging'] = false;
        listeners['changed::debug-logging']();
        expect(Logger.DEBUG).toBe(false);

        sm.destroy();
    });
});

